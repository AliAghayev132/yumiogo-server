import { FavoriteList, Restaurant, User, Notification } from "#models";
import {
  LIST_NAME_MAX,
  COLLABORATOR_ROLES,
  LISTS_PER_USER_MAX,
  LIST_ITEMS_MAX,
  LIST_COLLABORATORS_MAX,
} from "#models/favoriteList.model.js";
import { mongoose } from "#lib";
import { AccountService, FollowRequestService } from "#services";
import { asyncHandler } from "#utils";
import { favoritePrivacy } from "#constants";

/**
 * Favourite lists: the heart ("Saved" default list), the Add-to-list sheet,
 * custom lists, list saves ("32 saved"), collaborators and share links.
 *
 * Access policy (FavoriteList methods + canAccess below): public → anyone
 * views; collaborative → anyone with the link views, joined editors edit;
 * private → owner only. Lists of a suspended / banned / deleted owner are
 * gone for everybody else, and people who are not on the list also need the
 * owner's listsVisibility (private accounts: accepted followers only) — except
 * a collaborative list opened through its invite link (only members get it).
 *
 * Caps: LISTS_PER_USER_MAX lists, LIST_ITEMS_MAX restaurants per list,
 * LIST_COLLABORATORS_MAX collaborators (LIST_LIMIT / LIST_ITEMS_LIMIT /
 * LIST_COLLABORATORS_LIMIT). The default "Saved" list can be renamed and made
 * public / private, but not deleted, made collaborative or shared with
 * collaborators (LIST_DEFAULT_LOCKED).
 */

// Restaurants that can still be shown: only public (active, not in Trash) ones —
// a pending / suspended / rejected / closed restaurant would open as a 404.
const LIVE_RESTAURANT = { isDeleted: false, status: "active" };
const CARD_FIELDS =
  "name slug coverImages rating reviewCount reviewStats cuisines tags priceLevel avgPrice priceMin priceMax address city location openNow discountPercent saveCount status translations";
// Owner / collaborator fields (incl. what the access gate needs).
const PERSON_FIELDS = "firstName lastName avatar verified bio city isPrivate isDeleted status settings.listsVisibility";
// Mutual restaurants are computed for at most this many people per list.
const MUTUAL_PEOPLE_MAX = 50;

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, code });

const idOf = (ref) => (ref ? String(ref._id ?? ref) : "");
const isLiveUser = (u) => !!u && !u.isDeleted && (u.status === undefined || u.status === "active");

const cleanListName = (value) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");

const validateName = (value) => {
  const name = cleanListName(value);
  if (!name) return { error: "List name is required" };
  if (name.length > LIST_NAME_MAX) return { error: `List name must be at most ${LIST_NAME_MAX} characters` };
  return { name };
};

/** A live restaurant id or null. */
const findLiveRestaurant = async (id) => {
  if (!AccountService.isObjectId(String(id ?? ""))) return null;
  return Restaurant.findOne({ _id: id, ...LIVE_RESTAURANT }, "_id name");
};

/** Load a non-deleted list by :id (404 for bad ids / missing); the owner is always populated. */
const loadList = async (id, populate = false) => {
  if (!AccountService.isObjectId(String(id ?? ""))) return null;
  let query = FavoriteList.findOne({ _id: id, isDeleted: false }).populate("owner", PERSON_FIELDS);
  if (populate) {
    query = query
      .populate({ path: "items.restaurant", match: LIVE_RESTAURANT, select: CARD_FIELDS })
      .populate("collaborators.user", PERSON_FIELDS)
      .populate("items.addedBy", "firstName lastName avatar");
  }
  return query;
};

/**
 * May `viewer` open `list` (owner populated)? See the access policy above.
 * viaLink: opened through the share link (a collaborative list's invite).
 */
const canAccess = (list, viewer, { viaLink = false } = {}) => {
  const viewerId = viewer?._id ? String(viewer._id) : null;
  if (!list || !list.canView(viewerId)) return false;
  const role = list.roleOf(viewerId);
  if (role === "owner") return true;
  if (!list.owner || typeof list.owner !== "object" || !isLiveUser(list.owner)) return false;
  if (role) return true;
  if (viaLink && list.privacy === "collaborative") return true;
  return AccountService.canSeeLists(viewer, list.owner);
};

const canEditList = (list, viewer) => canAccess(list, viewer) && list.canEdit(viewer._id);

/** 404 / 403 for a list the viewer can't open (null when they can). */
const denyAccess = (res, list, viewer) => {
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (canAccess(list, viewer)) return null;
  const isOwner = list.roleOf(viewer?._id) === "owner";
  if (!isOwner && (!list.owner || !isLiveUser(list.owner))) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  return fail(res, 403, "This list is private", "LIST_PRIVATE");
};

const oid = (value) => new mongoose.Types.ObjectId(String(value));

/**
 * "N mutual restaurants" with each of `people` (viewer's saved restaurants ∩
 * theirs), counting only their lists the viewer could open: public /
 * collaborative lists of people whose lists the viewer may see
 * (listsVisibility / private account), or lists the viewer is a member of.
 * → Map userId → count (bounded to MUTUAL_PEOPLE_MAX people).
 */
const mutualCounts = async (viewer, people) => {
  const counts = new Map();
  const viewerId = viewer?._id ? String(viewer._id) : null;
  if (!viewerId) return counts;
  const others = people.filter((u) => u && idOf(u) !== viewerId && isLiveUser(u)).slice(0, MUTUAL_PEOPLE_MAX);
  if (!others.length) return counts;
  const mine = [...(await FavoriteList.ownerSavedSet(viewerId))].map(oid);
  if (!mine.length) return counts;
  const browsable = others.filter((u) => AccountService.canSeeLists(viewer, u)).map((u) => oid(idOf(u)));
  const shown = { $in: ["public", "collaborative"] };
  const rows = await FavoriteList.aggregate([
    {
      $match: {
        isDeleted: false,
        privacy: shown,
        "items.restaurant": { $in: mine },
        $or: [
          { owner: { $in: browsable } },
          { owner: { $in: others.map((u) => oid(idOf(u))) }, "collaborators.user": oid(viewerId) },
        ],
      },
    },
    { $unwind: "$items" },
    { $match: { "items.restaurant": { $in: mine } } },
    { $group: { _id: "$owner", restaurants: { $addToSet: "$items.restaurant" } } },
    { $project: { count: { $size: "$restaurants" } } },
  ]);
  rows.forEach((r) => counts.set(String(r._id), r.count));
  return counts;
};

/** Compact list row (Favorites index, profile, Add-to-list sheet). */
const summarize = (list, viewerId) => list.toSummary(viewerId);

/** Full list payload (list detail and share link). */
const detail = async (list, viewer) => {
  const viewerId = viewer?._id ? String(viewer._id) : null;
  const role = list.roleOf(viewerId);
  const following = new Set((viewer?.following || []).map(String));

  const collaborators = (list.collaborators || []).filter((c) => isLiveUser(c.user));
  const people = [list.owner, ...collaborators.map((c) => c.user)].filter((u) => u && typeof u === "object");
  const [mutual, statuses] = await Promise.all([
    mutualCounts(viewer, people),
    viewerId ? FollowRequestService.statusMap(viewer, people) : new Map(),
  ]);
  const person = (u) => ({
    ...AccountService.publicUser(u),
    isMe: idOf(u) === viewerId,
    isFollowing: following.has(idOf(u)),
    followStatus: idOf(u) === viewerId ? "none" : statuses.get(idOf(u)) || "none",
    mutualCount: idOf(u) === viewerId ? 0 : mutual.get(idOf(u)) || 0,
  });

  const items = (list.items || [])
    .filter((it) => it.restaurant && typeof it.restaurant === "object")
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
    .map((it) => ({
      restaurant: it.restaurant,
      savedAt: it.savedAt,
      addedBy: it.addedBy?.firstName
        ? { _id: it.addedBy._id, firstName: it.addedBy.firstName, lastName: it.addedBy.lastName, avatar: it.addedBy.avatar }
        : null,
    }));

  return {
    ...summarize(list, viewerId),
    owner: list.owner?.firstName ? person(list.owner) : list.owner,
    collaborators: collaborators.map((c) => ({
      user: person(c.user),
      role: c.role,
      addedAt: c.addedAt,
    })),
    items,
    canManage: list.canManage(viewerId),
    canJoin: !!viewerId && !role && list.privacy === "collaborative",
  };
};

/** Lists the user may add to / remove from (own + editor collaborations of live owners). */
const editableLists = async (viewer, select = undefined) => {
  const lists = await FavoriteList.find(
    { isDeleted: false, $or: [{ owner: viewer._id }, { "collaborators.user": viewer._id }] },
    select,
  ).populate("owner", PERSON_FIELDS);
  return lists.filter((l) => canEditList(l, viewer));
};

// Atomic item add / remove (no duplicates under double taps, never past the cap).
const pushItem = (listId, restaurantId, userId) =>
  FavoriteList.updateOne(
    {
      _id: listId,
      isDeleted: false,
      "items.restaurant": { $ne: restaurantId },
      [`items.${LIST_ITEMS_MAX - 1}`]: { $exists: false },
    },
    { $push: { items: { restaurant: restaurantId, savedAt: new Date(), addedBy: userId } } },
  );
// Filters on presence: with timestamps a no-op $pull would still count as modified.
const pullItem = (listId, restaurantId) =>
  FavoriteList.updateOne(
    { _id: listId, isDeleted: false, "items.restaurant": restaurantId },
    { $pull: { items: { restaurant: restaurantId } } },
  );

/**
 * Add a restaurant to a list and keep Restaurant.saveCount right from the
 * write's own result. → "added" | "exists" | "full"
 */
const addToList = async (list, restaurantId, userId) => {
  const result = await pushItem(list._id, restaurantId, userId);
  if (result.modifiedCount) {
    await FavoriteList.afterItemsAdded(idOf(list.owner), list._id, [restaurantId]);
    return "added";
  }
  const has = await FavoriteList.exists({ _id: list._id, "items.restaurant": restaurantId });
  return has ? "exists" : "full";
};

/** Remove a restaurant from a list (saveCount from the write's result). → true when removed */
const removeFromList = async (list, restaurantId) => {
  const result = await pullItem(list._id, restaurantId);
  if (!result.modifiedCount) return false;
  await FavoriteList.afterItemsRemoved(idOf(list.owner), [list._id], [restaurantId]);
  return true;
};

const itemsFull = (res) =>
  fail(res, 400, `A list can hold at most ${LIST_ITEMS_MAX} restaurants`, "LIST_ITEMS_LIMIT");
const defaultLocked = (res, message) => fail(res, 400, message, "LIST_DEFAULT_LOCKED");

const listHas = (list, restaurantId) => (list.items || []).some((it) => idOf(it.restaurant) === String(restaurantId));

// ================================================================= lists

/**
 * My lists — the default "Saved" list first, then owned / collaborating lists.
 * GET /api/favorites?restaurant=<id>   (restaurant → each row gets `contains`)
 */
const listMyLists = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const defaultList = await FavoriteList.ensureDefault(uid);

  const lists = await FavoriteList.find({
    isDeleted: false,
    $or: [{ owner: uid }, { "collaborators.user": uid }],
  })
    .populate({ path: "items.restaurant", match: LIVE_RESTAURANT, select: "coverImages name translations" })
    .populate("collaborators.user", "firstName lastName avatar isDeleted status")
    .populate("owner", PERSON_FIELDS);

  const restaurantId = AccountService.isObjectId(String(req.query.restaurant ?? "")) ? String(req.query.restaurant) : null;

  const shaped = lists
    .filter((l) => canAccess(l, req.user))
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((l) => {
      const row = summarize(l, uid);
      if (restaurantId) row.contains = listHas(l, restaurantId);
      return row;
    });

  res.json({ success: true, data: { lists: shaped, defaultListId: defaultList._id } });
});

/**
 * Other people's lists I saved to my collection.
 * GET /api/favorites/saved-lists
 */
const listSavedLists = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const lists = await FavoriteList.find({ isDeleted: false, followers: uid })
    .sort({ updatedAt: -1 })
    .populate({ path: "items.restaurant", match: LIVE_RESTAURANT, select: "coverImages name translations" })
    .populate("owner", PERSON_FIELDS);
  const shaped = lists.filter((l) => canAccess(l, req.user)).map((l) => summarize(l, uid));
  res.json({ success: true, data: { lists: shaped } });
});

/**
 * Create a list (optionally with the restaurant it was created for).
 * POST /api/favorites  { name, privacy?, restaurant? }
 */
const createList = asyncHandler(async (req, res) => {
  const { privacy = "private", restaurant } = req.body || {};
  const { name, error } = validateName(req.body?.name);
  if (error) return fail(res, 400, error, "LIST_NAME_INVALID");
  if (!favoritePrivacy.includes(privacy)) {
    return fail(res, 400, `Privacy must be one of: ${favoritePrivacy.join(", ")}`, "LIST_PRIVACY_INVALID");
  }

  let target = null;
  if (restaurant) {
    target = await findLiveRestaurant(restaurant);
    if (!target) return fail(res, 404, "Restaurant not found", "RESTAURANT_NOT_FOUND");
  }
  if ((await FavoriteList.countDocuments({ owner: req.user._id, isDeleted: false })) >= LISTS_PER_USER_MAX) {
    return fail(res, 400, `You can have at most ${LISTS_PER_USER_MAX} lists`, "LIST_LIMIT");
  }

  const list = await FavoriteList.create({
    name,
    privacy,
    owner: req.user._id,
    items: target ? [{ restaurant: target._id, addedBy: req.user._id }] : [],
  });
  if (target) await FavoriteList.afterItemsAdded(req.user._id, list._id, [target._id]);

  const fresh = await FavoriteList.findById(list._id).populate({
    path: "items.restaurant",
    match: LIVE_RESTAURANT,
    select: "coverImages name translations",
  });
  res.status(201).json({ success: true, message: "List created", data: { list: summarize(fresh, req.user._id) } });
});

/**
 * A list with its restaurants, owner and collaborators.
 * GET /api/favorites/:id
 */
const getList = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id, true);
  const denied = denyAccess(res, list, req.user);
  if (denied) return denied;

  const payload = await detail(list, req.user);
  res.json({
    success: true,
    data: {
      list: payload,
      canEdit: payload.canEdit,
      isOwner: payload.isOwner,
      canManage: payload.canManage,
      role: payload.role,
    },
  });
});

/**
 * Edit list (owner): rename and/or change privacy. Switching to private hides
 * the list from collaborators and people who saved it ("Make this list private?").
 * PUT|PATCH /api/favorites/:id  { name?, privacy? }
 */
const updateList = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canManage(req.user._id)) {
    return fail(res, 403, "Only the owner can edit this list", "LIST_FORBIDDEN");
  }

  const { privacy } = req.body || {};
  if (req.body?.name !== undefined) {
    const { name, error } = validateName(req.body.name);
    if (error) return fail(res, 400, error, "LIST_NAME_INVALID");
    list.name = name;
  }
  let lostAccess = 0;
  if (privacy !== undefined) {
    if (!favoritePrivacy.includes(privacy)) {
      return fail(res, 400, `Privacy must be one of: ${favoritePrivacy.join(", ")}`, "LIST_PRIVACY_INVALID");
    }
    if (list.isDefault && privacy === "collaborative") {
      return defaultLocked(res, "The Saved list can be public or private, not collaborative");
    }
    // A collaborative link makes its holder an editor: links handed out while
    // the list was public / private stop working.
    if (privacy === "collaborative" && list.privacy !== "collaborative") list.shareSlug = undefined;
    if (privacy === "private" && list.privacy !== "private") {
      lostAccess = new Set([
        ...(list.collaborators || []).map((c) => idOf(c.user)),
        ...(list.followers || []).map(idOf),
      ]).size;
    }
    list.privacy = privacy;
  }
  await list.save();

  const fresh = await loadList(list._id, true);
  res.json({
    success: true,
    message: "List updated",
    data: { list: await detail(fresh, req.user), lostAccess },
  });
});

/**
 * Delete a list (owner). Restaurant save counters are corrected.
 * DELETE /api/favorites/:id
 */
const deleteList = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canManage(req.user._id)) {
    return fail(res, 403, "Only the owner can delete this list", "LIST_FORBIDDEN");
  }
  if (list.isDefault) return defaultLocked(res, "The Saved list can't be deleted");

  const restaurantIds = (list.items || []).map((it) => String(it.restaurant));
  const result = await FavoriteList.updateOne(
    { _id: list._id, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date() } },
  );
  if (result.modifiedCount) await FavoriteList.afterItemsRemoved(idOf(list.owner), [list._id], restaurantIds);
  await Notification.retract({ list: list._id });

  res.json({ success: true, message: "List deleted", data: { listId: list._id, wasDefault: !!list.isDefault } });
});

// ================================================================= items

/**
 * Add a restaurant to a list (owner or editor).
 * POST /api/favorites/:id/items  { restaurant }
 */
const addItem = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list || !canAccess(list, req.user)) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canEdit(req.user._id)) return fail(res, 403, "You cannot edit this list", "LIST_FORBIDDEN");

  const restaurant = await findLiveRestaurant(req.body?.restaurant);
  if (!restaurant) return fail(res, 404, "Restaurant not found", "RESTAURANT_NOT_FOUND");

  const outcome = await addToList(list, restaurant._id, req.user._id);
  if (outcome === "full") return itemsFull(res);
  const [itemCount, fresh] = await Promise.all([
    FavoriteList.liveItemCount(list._id),
    FavoriteList.findById(list._id, "updatedAt").lean(),
  ]);
  res.json({
    success: true,
    message: outcome === "added" ? "Added to list" : "Already in this list",
    data: { listId: list._id, added: outcome === "added", itemCount, updatedAt: fresh.updatedAt },
  });
});

/**
 * Remove a restaurant from a list (owner or editor).
 * DELETE /api/favorites/:id/items/:restaurantId
 */
const removeItem = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list || !canAccess(list, req.user)) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canEdit(req.user._id)) return fail(res, 403, "You cannot edit this list", "LIST_FORBIDDEN");
  const rid = req.params.restaurantId;
  if (!AccountService.isObjectId(rid)) return fail(res, 400, "Invalid restaurant id", "RESTAURANT_INVALID");

  const removed = await removeFromList(list, rid);
  const [itemCount, fresh] = await Promise.all([
    FavoriteList.liveItemCount(list._id),
    FavoriteList.findById(list._id, "updatedAt").lean(),
  ]);
  res.json({
    success: true,
    message: removed ? "Removed from list" : "Not in this list",
    data: { listId: list._id, removed, itemCount, updatedAt: fresh.updatedAt },
  });
});

/**
 * The heart: toggle a restaurant in the user's default "Saved" list.
 * POST /api/favorites/toggle  { restaurant }
 */
const toggleFavorite = asyncHandler(async (req, res) => {
  const rid = String(req.body?.restaurant ?? "");
  if (!AccountService.isObjectId(rid)) return fail(res, 400, "restaurant is required", "RESTAURANT_INVALID");

  const uid = req.user._id;
  const list = await FavoriteList.ensureDefault(uid);
  const inList = listHas(list, rid);

  if (!inList && !(await findLiveRestaurant(rid))) {
    return fail(res, 404, "Restaurant not found", "RESTAURANT_NOT_FOUND");
  }

  if (inList) {
    await removeFromList(list, rid);
  } else if ((await addToList(list, rid, uid)) === "full") {
    return itemsFull(res);
  }

  const lists = await FavoriteList.find({ owner: uid, isDeleted: false, "items.restaurant": rid }, "_id").lean();
  res.json({
    success: true,
    message: inList ? "Removed from Saved" : "Added to Saved",
    data: {
      saved: !inList,
      listId: list._id,
      listName: list.name,
      savedAnywhere: lists.length > 0,
      listIds: lists.map((l) => l._id),
    },
  });
});

/**
 * Heart hydration. `ids` = restaurants in the default "Saved" list (what the
 * heart toggles); `allIds` / `lists` = membership across every list I own or edit.
 * GET /api/favorites/saved-ids
 */
const getSavedIds = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const lists = await editableLists(req.user, "owner privacy collaborators isDefault items.restaurant");
  const byRestaurant = {};
  const defaultIds = [];
  let defaultListId = null;
  lists.forEach((l) => {
      const mineDefault = l.isDefault && idOf(l.owner) === String(uid);
      if (mineDefault) defaultListId = l._id;
      l.items.forEach((it) => {
        const rid = String(it.restaurant);
        (byRestaurant[rid] ||= []).push(l._id);
        if (mineDefault) defaultIds.push(rid);
      });
  });
  res.json({
    success: true,
    data: {
      ids: defaultIds,
      savedIds: defaultIds,
      allIds: Object.keys(byRestaurant),
      lists: byRestaurant,
      defaultListId,
    },
  });
});

/**
 * Add-to-list sheet: every list I can edit with a `contains` flag.
 * GET /api/favorites/items/:restaurantId
 */
const getMembership = asyncHandler(async (req, res) => {
  const rid = req.params.restaurantId;
  if (!AccountService.isObjectId(rid)) return fail(res, 400, "Invalid restaurant id", "RESTAURANT_INVALID");
  const uid = req.user._id;
  await FavoriteList.ensureDefault(uid);

  const lists = (await editableLists(req.user)).sort(
    (a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt),
  );
  await FavoriteList.populate(lists, [
    { path: "items.restaurant", match: LIVE_RESTAURANT, select: "coverImages name translations" },
  ]);
  const rows = lists.map((l) => ({ ...summarize(l, uid), contains: listHas(l, rid) }));
  res.json({
    success: true,
    data: {
      restaurant: rid,
      lists: rows,
      listIds: rows.filter((r) => r.contains).map((r) => r._id),
      defaultListId: rows.find((r) => r.isDefault && r.isOwner)?._id || null,
    },
  });
});

/**
 * Add-to-list sheet "Done": the restaurant ends up in exactly `listIds`
 * (among the lists I can edit).
 * PUT /api/favorites/items/:restaurantId  { listIds: [] }
 */
const setMembership = asyncHandler(async (req, res) => {
  const rid = req.params.restaurantId;
  if (!AccountService.isObjectId(rid)) return fail(res, 400, "Invalid restaurant id", "RESTAURANT_INVALID");
  const wanted = req.body?.listIds;
  if (!Array.isArray(wanted) || wanted.length > 100) {
    return fail(res, 400, "listIds must be an array of list ids", "LIST_IDS_INVALID");
  }
  const wantedIds = new Set(wanted.map(String));
  const uid = req.user._id;

  const lists = await editableLists(req.user);
  const editableIds = new Set(lists.map((l) => String(l._id)));
  const unknown = [...wantedIds].filter((id) => !editableIds.has(id));
  if (unknown.length) return fail(res, 403, "You cannot edit one or more of these lists", "LIST_FORBIDDEN");

  const adding = lists.filter((l) => wantedIds.has(String(l._id)) && !listHas(l, rid));
  const removing = lists.filter((l) => !wantedIds.has(String(l._id)) && listHas(l, rid));
  if (adding.length && !(await findLiveRestaurant(rid))) {
    return fail(res, 404, "Restaurant not found", "RESTAURANT_NOT_FOUND");
  }
  if (adding.some((l) => (l.items || []).length >= LIST_ITEMS_MAX)) return itemsFull(res);

  // One write at a time: each saveCount change follows its own write result.
  for (const l of adding) await addToList(l, rid, uid);
  for (const l of removing) await removeFromList(l, rid);

  const now = await FavoriteList.find(
    { _id: { $in: [...editableIds] }, isDeleted: false, "items.restaurant": rid },
    "_id isDefault owner",
  ).lean();
  res.json({
    success: true,
    message: "Lists updated",
    data: {
      restaurant: rid,
      listIds: now.map((l) => l._id),
      added: adding.map((l) => l._id),
      removed: removing.map((l) => l._id),
      saved: now.some((l) => l.isDefault && String(l.owner) === String(uid)),
      savedAnywhere: now.length > 0,
    },
  });
});

// ============================================================ list saves

/**
 * Save someone's list to my collection ("added your favourites list to their collection").
 * POST /api/favorites/:id/follow
 */
const followList = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  const denied = denyAccess(res, list, req.user);
  if (denied) return denied;
  if (list.canManage(req.user._id)) return fail(res, 400, "This is your own list", "LIST_OWN");

  const result = await FavoriteList.updateOne(
    { _id: list._id, followers: { $ne: req.user._id } },
    { $push: { followers: req.user._id }, $inc: { saveCount: 1 } },
    { timestamps: false },
  );
  if (result.modifiedCount) {
    Notification.notify({ recipient: idOf(list.owner), actor: req.user._id, type: "list_save", list: list._id }).catch(
      () => {},
    );
  }
  const fresh = await FavoriteList.findById(list._id, "saveCount").lean();
  res.json({ success: true, message: "List saved", data: { saved: true, saveCount: fresh.saveCount } });
});

/**
 * Remove someone's list from my collection.
 * DELETE /api/favorites/:id/follow
 */
const unfollowList = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  await FavoriteList.updateOne(
    { _id: list._id, followers: req.user._id },
    { $pull: { followers: req.user._id }, $inc: { saveCount: -1 } },
    { timestamps: false },
  );
  const fresh = await FavoriteList.findById(list._id, "saveCount").lean();
  res.json({
    success: true,
    message: "List removed from your collection",
    data: { saved: false, saveCount: Math.max(0, fresh.saveCount || 0) },
  });
});

// ========================================================= collaborators

/**
 * Manage users: owner + collaborators with follow state and mutual restaurants.
 * GET /api/favorites/:id/collaborators
 */
const getCollaborators = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id, true);
  const denied = denyAccess(res, list, req.user);
  if (denied) return denied;
  const payload = await detail(list, req.user);
  res.json({
    success: true,
    data: {
      owner: payload.owner,
      collaborators: payload.collaborators,
      count: payload.collaborators.length,
      canManage: payload.canManage,
      role: payload.role,
    },
  });
});

/**
 * Add (or re-role) a collaborator (owner).
 * POST /api/favorites/:id/collaborators  { userId, role? = "editor" }
 */
const addCollaborator = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canManage(req.user._id)) return fail(res, 403, "Only the owner can manage users", "LIST_FORBIDDEN");
  if (list.isDefault) return defaultLocked(res, "The Saved list can't have collaborators");
  if (list.privacy === "private") {
    return fail(res, 400, "Make the list collaborative or public to share it", "LIST_PRIVATE");
  }

  const { userId, role = "editor" } = req.body || {};
  if (!COLLABORATOR_ROLES.includes(role)) {
    return fail(res, 400, `Role must be one of: ${COLLABORATOR_ROLES.join(", ")}`, "ROLE_INVALID");
  }
  if (!AccountService.isObjectId(String(userId ?? ""))) return fail(res, 400, "Invalid user id", "USER_INVALID");
  if (String(userId) === String(req.user._id)) return fail(res, 400, "You already own this list", "LIST_OWN");
  const user = await User.findOne({ _id: userId, isDeleted: false, status: "active" }, "_id");
  if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");

  const existing = list.collaborators.find((c) => idOf(c.user) === String(userId));
  if (existing) {
    existing.role = role;
  } else if (list.collaborators.length >= LIST_COLLABORATORS_MAX) {
    return collaboratorsFull(res);
  } else {
    list.collaborators.push({ user: user._id, role, addedBy: req.user._id });
  }
  await list.save();
  if (!existing) {
    Notification.notify({
      recipient: user._id,
      actor: req.user._id,
      type: "collaborator_invite",
      list: list._id,
    }).catch(() => {});
  }

  const fresh = await loadList(list._id, true);
  const payload = await detail(fresh, req.user);
  res.status(existing ? 200 : 201).json({
    success: true,
    message: existing ? "Role updated" : "User added to the list",
    data: { collaborators: payload.collaborators, count: payload.collaborators.length },
  });
});

/**
 * Change a collaborator's role (owner).
 * PATCH /api/favorites/:id/collaborators/:userId  { role }
 */
const updateCollaborator = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canManage(req.user._id)) return fail(res, 403, "Only the owner can manage users", "LIST_FORBIDDEN");
  const { role } = req.body || {};
  if (!COLLABORATOR_ROLES.includes(role)) {
    return fail(res, 400, `Role must be one of: ${COLLABORATOR_ROLES.join(", ")}`, "ROLE_INVALID");
  }
  const entry = list.collaborators.find((c) => idOf(c.user) === String(req.params.userId));
  if (!entry) return fail(res, 404, "This user is not on the list", "COLLABORATOR_NOT_FOUND");
  entry.role = role;
  await list.save();
  res.json({ success: true, message: "Role updated", data: { userId: req.params.userId, role } });
});

/**
 * Remove a collaborator (owner), or leave the list (the collaborator: userId = "me").
 * DELETE /api/favorites/:id/collaborators/:userId
 */
const removeCollaborator = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  const me = String(req.user._id);
  const target = req.params.userId === "me" ? me : String(req.params.userId);
  if (target !== me && !list.canManage(me)) {
    return fail(res, 403, "Only the owner can manage users", "LIST_FORBIDDEN");
  }
  if (target === idOf(list.owner)) return fail(res, 400, "The owner can't leave their own list", "LIST_OWN");

  const result = await FavoriteList.updateOne(
    { _id: list._id, "collaborators.user": target },
    { $pull: { collaborators: { user: target } } },
  );
  if (!result.modifiedCount) return fail(res, 404, "This user is not on the list", "COLLABORATOR_NOT_FOUND");
  res.json({
    success: true,
    message: target === me ? "You left the list" : "User removed from the list",
    data: { userId: target },
  });
});

// ============================================================ share link

const collaboratorsFull = (res) =>
  fail(res, 400, `A list can have at most ${LIST_COLLABORATORS_MAX} collaborators`, "LIST_COLLABORATORS_LIMIT");

/**
 * Open a shared list by its slug (share link / deep link). Guests allowed.
 * GET /api/favorites/share/:slug
 */
const getSharedList = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").slice(0, 120);
  const found = await FavoriteList.findOne({ shareSlug: slug, isDeleted: false }, "_id");
  const list = found ? await loadList(found._id, true) : null;
  // Lists the viewer can't open look like missing ones (private lists to
  // everybody but the owner).
  if (!canAccess(list, req.user || null, { viaLink: true })) return fail(res, 404, "List not found", "LIST_NOT_FOUND");

  const payload = await detail(list, req.user || null);
  res.json({
    success: true,
    data: {
      list: payload,
      canEdit: payload.canEdit,
      isOwner: payload.isOwner,
      role: payload.role,
      canJoin: payload.canJoin,
    },
  });
});

/**
 * Join through the share link: collaborative → become an editor;
 * public → save the list to my collection.
 * POST /api/favorites/share/:slug/join
 */
const joinSharedList = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").slice(0, 120);
  const list = await FavoriteList.findOne({ shareSlug: slug, isDeleted: false }).populate("owner", PERSON_FIELDS);
  if (!list || list.privacy === "private") return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  const uid = req.user._id;
  if (list.canManage(uid)) return fail(res, 400, "This is your own list", "LIST_OWN");
  if (!canAccess(list, req.user, { viaLink: true })) return fail(res, 404, "List not found", "LIST_NOT_FOUND");

  const role = list.roleOf(uid);
  if (list.privacy === "collaborative") {
    if (!role) {
      const joined = await FavoriteList.updateOne(
        {
          _id: list._id,
          "collaborators.user": { $ne: uid },
          [`collaborators.${LIST_COLLABORATORS_MAX - 1}`]: { $exists: false },
        },
        { $push: { collaborators: { user: uid, role: "editor", addedBy: null, addedAt: new Date() } } },
      );
      if (!joined.modifiedCount && !(await FavoriteList.exists({ _id: list._id, "collaborators.user": uid }))) {
        return collaboratorsFull(res);
      }
    }
  } else {
    const result = await FavoriteList.updateOne(
      { _id: list._id, followers: { $ne: uid } },
      { $push: { followers: uid }, $inc: { saveCount: 1 } },
      { timestamps: false },
    );
    if (result.modifiedCount) {
      Notification.notify({ recipient: idOf(list.owner), actor: uid, type: "list_save", list: list._id }).catch(
        () => {},
      );
    }
  }

  const fresh = await loadList(list._id, true);
  const payload = await detail(fresh, req.user);
  res.json({
    success: true,
    message: list.privacy === "collaborative" ? "You joined the list" : "List saved",
    data: { list: payload, role: payload.role, joined: list.privacy === "collaborative", saved: payload.isSaved },
  });
});

export {
  listMyLists,
  listSavedLists,
  createList,
  getList,
  updateList,
  deleteList,
  addItem,
  removeItem,
  toggleFavorite,
  getSavedIds,
  getMembership,
  setMembership,
  followList,
  unfollowList,
  getCollaborators,
  addCollaborator,
  updateCollaborator,
  removeCollaborator,
  getSharedList,
  joinSharedList,
};
