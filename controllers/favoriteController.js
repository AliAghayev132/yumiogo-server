import { FavoriteList, Restaurant, User, Notification } from "#models";
import { LIST_NAME_MAX, COLLABORATOR_ROLES } from "#models/favoriteList.model.js";
import { AccountService } from "#services";
import { asyncHandler } from "#utils";
import { favoritePrivacy } from "#constants";

/**
 * Favourite lists: the heart ("Saved" default list), the Add-to-list sheet,
 * custom lists, list saves ("32 saved"), collaborators and share links.
 *
 * Access policy (FavoriteList methods): public → anyone views; collaborative →
 * anyone with the link views, joined editors edit; private → owner only.
 */

// Restaurants that can still be shown: only public (active, not in Trash) ones —
// a pending / suspended / rejected / closed restaurant would open as a 404.
const LIVE_RESTAURANT = { isDeleted: false, status: "active" };
const CARD_FIELDS =
  "name slug coverImages rating reviewCount cuisines tags priceLevel avgPrice priceMin priceMax address city location openNow discountPercent saveCount status";
const PERSON_FIELDS = "firstName lastName avatar verified bio city isPrivate isDeleted status";

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

/** Load a non-deleted list by :id (404 for bad ids / missing). */
const loadList = async (id, populate = false) => {
  if (!AccountService.isObjectId(String(id ?? ""))) return null;
  let query = FavoriteList.findOne({ _id: id, isDeleted: false });
  if (populate) {
    query = query
      .populate({ path: "items.restaurant", match: LIVE_RESTAURANT, select: CARD_FIELDS })
      .populate("owner", PERSON_FIELDS)
      .populate("collaborators.user", PERSON_FIELDS)
      .populate("items.addedBy", "firstName lastName avatar");
  }
  return query;
};

/** Restaurant ids saved by each of `ownerIds` (for "N mutual restaurants"). */
const savedSetsByOwner = async (ownerIds) => {
  const ids = [...new Set(ownerIds.map(String))];
  const lists = await FavoriteList.find(
    { owner: { $in: ids }, isDeleted: false },
    "owner items.restaurant",
  ).lean();
  const sets = new Map(ids.map((id) => [id, new Set()]));
  lists.forEach((l) => (l.items || []).forEach((it) => sets.get(String(l.owner))?.add(String(it.restaurant))));
  return sets;
};

const intersectionSize = (a, b) => {
  if (!a || !b) return 0;
  let n = 0;
  a.forEach((v) => {
    if (b.has(v)) n += 1;
  });
  return n;
};

/** Compact list row (Favorites index, profile, Add-to-list sheet). */
const summarize = (list, viewerId) => list.toSummary(viewerId);

/** Full list payload (list detail and share link). */
const detail = async (list, viewer) => {
  const viewerId = viewer?._id ? String(viewer._id) : null;
  const role = list.roleOf(viewerId);
  const following = new Set((viewer?.following || []).map(String));

  const collaborators = (list.collaborators || []).filter((c) => isLiveUser(c.user));
  const people = [idOf(list.owner), ...collaborators.map((c) => idOf(c.user))];
  const sets = viewerId ? await savedSetsByOwner([viewerId, ...people]) : new Map();
  const mine = viewerId ? sets.get(viewerId) : null;
  const person = (u) => ({
    ...AccountService.publicUser(u),
    isMe: idOf(u) === viewerId,
    isFollowing: following.has(idOf(u)),
    mutualCount: idOf(u) === viewerId ? 0 : intersectionSize(mine, sets.get(idOf(u))),
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

/** Lists the user may add to / remove from (own + editor collaborations). */
const editableLists = async (userId) => {
  const lists = await FavoriteList.find({
    isDeleted: false,
    $or: [{ owner: userId }, { "collaborators.user": userId }],
  });
  return lists.filter((l) => l.canEdit(userId));
};

// Atomic item add / remove (no duplicates under double taps).
const pushItem = (listId, restaurantId, userId) =>
  FavoriteList.updateOne(
    { _id: listId, isDeleted: false, "items.restaurant": { $ne: restaurantId } },
    { $push: { items: { restaurant: restaurantId, savedAt: new Date(), addedBy: userId } } },
  );
// Filters on presence: with timestamps a no-op $pull would still count as modified.
const pullItem = (listId, restaurantId) =>
  FavoriteList.updateOne(
    { _id: listId, isDeleted: false, "items.restaurant": restaurantId },
    { $pull: { items: { restaurant: restaurantId } } },
  );

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
    .populate({ path: "items.restaurant", match: LIVE_RESTAURANT, select: "coverImages name" })
    .populate("collaborators.user", "firstName lastName avatar isDeleted status")
    .populate("owner", PERSON_FIELDS);

  const restaurantId = AccountService.isObjectId(String(req.query.restaurant ?? "")) ? String(req.query.restaurant) : null;

  const shaped = lists
    .filter((l) => l.canView(uid))
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
    .populate({ path: "items.restaurant", match: LIVE_RESTAURANT, select: "coverImages name" })
    .populate("owner", PERSON_FIELDS);
  const shaped = lists.filter((l) => l.canView(uid) && isLiveUser(l.owner)).map((l) => summarize(l, uid));
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

  const list = await FavoriteList.trackSaves(req.user._id, target ? [target._id] : [], () =>
    FavoriteList.create({
      name,
      privacy,
      owner: req.user._id,
      items: target ? [{ restaurant: target._id, addedBy: req.user._id }] : [],
    }),
  );

  const fresh = await FavoriteList.findById(list._id).populate({
    path: "items.restaurant",
    match: LIVE_RESTAURANT,
    select: "coverImages name",
  });
  res.status(201).json({ success: true, message: "List created", data: { list: summarize(fresh, req.user._id) } });
});

/**
 * A list with its restaurants, owner and collaborators.
 * GET /api/favorites/:id
 */
const getList = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id, true);
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canView(req.user._id)) return fail(res, 403, "This list is private", "LIST_PRIVATE");

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

  const restaurantIds = (list.items || []).map((it) => String(it.restaurant));
  await FavoriteList.trackSaves(list.owner, restaurantIds, () =>
    FavoriteList.updateOne({ _id: list._id }, { $set: { isDeleted: true, deletedAt: new Date() } }),
  );
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
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canEdit(req.user._id)) return fail(res, 403, "You cannot edit this list", "LIST_FORBIDDEN");

  const restaurant = await findLiveRestaurant(req.body?.restaurant);
  if (!restaurant) return fail(res, 404, "Restaurant not found", "RESTAURANT_NOT_FOUND");

  const result = await FavoriteList.trackSaves(list.owner, [restaurant._id], () =>
    pushItem(list._id, restaurant._id, req.user._id),
  );
  const fresh = await FavoriteList.findById(list._id, "items updatedAt").lean();
  res.json({
    success: true,
    message: result.modifiedCount ? "Added to list" : "Already in this list",
    data: { listId: list._id, added: !!result.modifiedCount, itemCount: fresh.items.length, updatedAt: fresh.updatedAt },
  });
});

/**
 * Remove a restaurant from a list (owner or editor).
 * DELETE /api/favorites/:id/items/:restaurantId
 */
const removeItem = asyncHandler(async (req, res) => {
  const list = await loadList(req.params.id);
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canEdit(req.user._id)) return fail(res, 403, "You cannot edit this list", "LIST_FORBIDDEN");
  const rid = req.params.restaurantId;
  if (!AccountService.isObjectId(rid)) return fail(res, 400, "Invalid restaurant id", "RESTAURANT_INVALID");

  const result = await FavoriteList.trackSaves(list.owner, [rid], () => pullItem(list._id, rid));
  const fresh = await FavoriteList.findById(list._id, "items updatedAt").lean();
  res.json({
    success: true,
    message: result.modifiedCount ? "Removed from list" : "Not in this list",
    data: { listId: list._id, removed: !!result.modifiedCount, itemCount: fresh.items.length, updatedAt: fresh.updatedAt },
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

  await FavoriteList.trackSaves(uid, [rid], () => (inList ? pullItem(list._id, rid) : pushItem(list._id, rid, uid)));

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
  const lists = await FavoriteList.find(
    { isDeleted: false, $or: [{ owner: uid }, { "collaborators.user": uid }] },
    "owner privacy collaborators isDefault items.restaurant",
  );
  const byRestaurant = {};
  const defaultIds = [];
  let defaultListId = null;
  lists
    .filter((l) => l.canEdit(uid))
    .forEach((l) => {
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

  const lists = (await editableLists(uid)).sort(
    (a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt),
  );
  await FavoriteList.populate(lists, [
    { path: "items.restaurant", match: LIVE_RESTAURANT, select: "coverImages name" },
    { path: "owner", select: PERSON_FIELDS },
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

  const lists = await editableLists(uid);
  const editableIds = new Set(lists.map((l) => String(l._id)));
  const unknown = [...wantedIds].filter((id) => !editableIds.has(id));
  if (unknown.length) return fail(res, 403, "You cannot edit one or more of these lists", "LIST_FORBIDDEN");

  const adding = lists.filter((l) => wantedIds.has(String(l._id)) && !listHas(l, rid));
  const removing = lists.filter((l) => !wantedIds.has(String(l._id)) && listHas(l, rid));
  if (adding.length && !(await findLiveRestaurant(rid))) {
    return fail(res, 404, "Restaurant not found", "RESTAURANT_NOT_FOUND");
  }

  // saveCount is per list owner — group the changes by owner.
  const owners = new Set([...adding, ...removing].map((l) => idOf(l.owner)));
  for (const owner of owners) {
    await FavoriteList.trackSaves(owner, [rid], () =>
      Promise.all([
        ...adding.filter((l) => idOf(l.owner) === owner).map((l) => pushItem(l._id, rid, uid)),
        ...removing.filter((l) => idOf(l.owner) === owner).map((l) => pullItem(l._id, rid)),
      ]),
    );
  }

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
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canView(req.user._id)) return fail(res, 403, "This list is private", "LIST_PRIVATE");
  if (list.canManage(req.user._id)) return fail(res, 400, "This is your own list", "LIST_OWN");

  const result = await FavoriteList.updateOne(
    { _id: list._id, followers: { $ne: req.user._id } },
    { $push: { followers: req.user._id }, $inc: { saveCount: 1 } },
    { timestamps: false },
  );
  if (result.modifiedCount) {
    Notification.notify({ recipient: list.owner, actor: req.user._id, type: "list_save", list: list._id }).catch(
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
  if (!list) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!list.canView(req.user._id)) return fail(res, 403, "This list is private", "LIST_PRIVATE");
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

/**
 * Open a shared list by its slug (share link / deep link). Guests allowed.
 * GET /api/favorites/share/:slug
 */
const getSharedList = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").slice(0, 120);
  const found = await FavoriteList.findOne({ shareSlug: slug, isDeleted: false }, "_id");
  const list = found ? await loadList(found._id, true) : null;
  const viewerId = req.user?._id || null;
  // Private lists look like missing ones to everybody but the owner.
  if (!list || !list.canView(viewerId)) return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  if (!isLiveUser(list.owner)) return fail(res, 404, "List not found", "LIST_NOT_FOUND");

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
  const list = await FavoriteList.findOne({ shareSlug: slug, isDeleted: false });
  if (!list || list.privacy === "private") return fail(res, 404, "List not found", "LIST_NOT_FOUND");
  const uid = req.user._id;
  if (list.canManage(uid)) return fail(res, 400, "This is your own list", "LIST_OWN");

  let role = list.roleOf(uid);
  if (list.privacy === "collaborative") {
    if (!role) {
      await FavoriteList.updateOne(
        { _id: list._id, "collaborators.user": { $ne: uid } },
        { $push: { collaborators: { user: uid, role: "editor", addedBy: null, addedAt: new Date() } } },
      );
      role = "editor";
    }
  } else {
    const result = await FavoriteList.updateOne(
      { _id: list._id, followers: { $ne: uid } },
      { $push: { followers: uid }, $inc: { saveCount: 1 } },
      { timestamps: false },
    );
    if (result.modifiedCount) {
      Notification.notify({ recipient: list.owner, actor: uid, type: "list_save", list: list._id }).catch(() => {});
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
