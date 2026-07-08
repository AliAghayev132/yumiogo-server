import { FavoriteList, Restaurant } from "#models";
import { asyncHandler } from "#utils";

const DEFAULT_LIST_NAME = "Saved";

// Access check: can this user view the list?
const canView = (list, userId) => {
  if (list.privacy === "public") return true;
  if (list.owner.toString() === userId) return true;
  return list.collaborators.some((c) => c.user.toString() === userId);
};

// Can this user edit (add/remove items)?
const canEdit = (list, userId) => {
  if (list.owner.toString() === userId) return true;
  if (list.privacy !== "collaborative") return false;
  return list.collaborators.some(
    (c) => c.user.toString() === userId && c.role === "editor",
  );
};

/**
 * My lists — owned or collaborating, with counts + cover thumbnails.
 * GET /api/favorites
 */
const listMyLists = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const lists = await FavoriteList.find({
    isDeleted: false,
    $or: [{ owner: uid }, { "collaborators.user": uid }],
  })
    .sort({ updatedAt: -1 })
    .populate("items.restaurant", "coverImages name")
    .lean({ virtuals: true });

  const shaped = lists.map((l) => ({
    _id: l._id,
    name: l.name,
    privacy: l.privacy,
    shareSlug: l.shareSlug,
    itemCount: l.items.length,
    owner: l.owner,
    updatedAt: l.updatedAt,
    thumbnails: l.items
      .map((it) => it.restaurant?.coverImages?.[0])
      .filter(Boolean)
      .slice(0, 4),
  }));

  res.json({ success: true, data: { lists: shaped } });
});

/**
 * Create a list.
 * POST /api/favorites  { name, privacy }
 */
const createList = asyncHandler(async (req, res) => {
  const { name, privacy } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "List name is required" });
  }
  const list = await FavoriteList.create({
    name: name.trim(),
    privacy: privacy || "private",
    owner: req.user._id,
  });
  res.status(201).json({ success: true, message: "List created", data: { list } });
});

/**
 * Get a list with its restaurants + collaborators.
 * GET /api/favorites/:id
 */
const getList = asyncHandler(async (req, res) => {
  const list = await FavoriteList.findOne({ _id: req.params.id, isDeleted: false })
    .populate("items.restaurant")
    .populate("collaborators.user", "firstName lastName avatar")
    .populate("owner", "firstName lastName avatar");
  if (!list) return res.status(404).json({ success: false, message: "List not found" });

  if (!canView(list, req.user._id.toString())) {
    return res.status(403).json({ success: false, message: "You cannot view this list" });
  }
  res.json({
    success: true,
    data: { list, canEdit: canEdit(list, req.user._id.toString()) },
  });
});

/**
 * Update a list (owner only).
 * PUT /api/favorites/:id  { name?, privacy? }
 */
const updateList = asyncHandler(async (req, res) => {
  const list = await FavoriteList.findOne({ _id: req.params.id, isDeleted: false });
  if (!list) return res.status(404).json({ success: false, message: "List not found" });
  if (list.owner.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Only the owner can edit this list" });
  }
  const { name, privacy } = req.body;
  if (name !== undefined) list.name = name.trim();
  if (privacy !== undefined) list.privacy = privacy;
  await list.save();
  res.json({ success: true, message: "List updated", data: { list } });
});

/**
 * Delete a list (owner only).
 * DELETE /api/favorites/:id
 */
const deleteList = asyncHandler(async (req, res) => {
  const list = await FavoriteList.findOne({ _id: req.params.id, isDeleted: false });
  if (!list) return res.status(404).json({ success: false, message: "List not found" });
  if (list.owner.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: "Only the owner can delete this list" });
  }
  list.isDeleted = true;
  await list.save();
  res.json({ success: true, message: "List deleted" });
});

/**
 * Add a restaurant to a list.
 * POST /api/favorites/:id/items  { restaurant }
 */
const addItem = asyncHandler(async (req, res) => {
  const { restaurant } = req.body;
  const list = await FavoriteList.findOne({ _id: req.params.id, isDeleted: false });
  if (!list) return res.status(404).json({ success: false, message: "List not found" });
  if (!canEdit(list, req.user._id.toString())) {
    return res.status(403).json({ success: false, message: "You cannot edit this list" });
  }
  const exists = await Restaurant.exists({ _id: restaurant, isDeleted: false });
  if (!exists) return res.status(404).json({ success: false, message: "Restaurant not found" });

  if (!list.items.some((it) => it.restaurant.toString() === restaurant)) {
    list.items.push({ restaurant });
    await list.save();
    await Restaurant.updateOne({ _id: restaurant }, { $inc: { saveCount: 1 } });
  }
  res.json({ success: true, message: "Added to list", data: { itemCount: list.items.length } });
});

/**
 * Remove a restaurant from a list.
 * DELETE /api/favorites/:id/items/:restaurantId
 */
const removeItem = asyncHandler(async (req, res) => {
  const list = await FavoriteList.findOne({ _id: req.params.id, isDeleted: false });
  if (!list) return res.status(404).json({ success: false, message: "List not found" });
  if (!canEdit(list, req.user._id.toString())) {
    return res.status(403).json({ success: false, message: "You cannot edit this list" });
  }
  const before = list.items.length;
  list.items = list.items.filter((it) => it.restaurant.toString() !== req.params.restaurantId);
  if (list.items.length !== before) {
    await list.save();
    await Restaurant.updateOne({ _id: req.params.restaurantId }, { $inc: { saveCount: -1 } });
  }
  res.json({ success: true, message: "Removed from list", data: { itemCount: list.items.length } });
});

/**
 * Toggle a restaurant in the user's default "Saved" list (backs the heart button).
 * POST /api/favorites/toggle  { restaurant }
 */
const toggleFavorite = asyncHandler(async (req, res) => {
  const { restaurant } = req.body;
  if (!restaurant) {
    return res.status(400).json({ success: false, message: "restaurant is required" });
  }
  let list = await FavoriteList.findOne({
    owner: req.user._id,
    name: DEFAULT_LIST_NAME,
    isDeleted: false,
  });
  if (!list) {
    list = await FavoriteList.create({
      name: DEFAULT_LIST_NAME,
      owner: req.user._id,
      privacy: "private",
    });
  }

  const idx = list.items.findIndex((it) => it.restaurant.toString() === restaurant);
  let saved;
  if (idx >= 0) {
    list.items.splice(idx, 1);
    saved = false;
    await Restaurant.updateOne({ _id: restaurant }, { $inc: { saveCount: -1 } });
  } else {
    list.items.push({ restaurant });
    saved = true;
    await Restaurant.updateOne({ _id: restaurant }, { $inc: { saveCount: 1 } });
  }
  await list.save();
  res.json({ success: true, data: { saved, listId: list._id } });
});

/**
 * IDs of restaurants the user has saved anywhere (for hydrating heart states).
 * GET /api/favorites/saved-ids
 */
const getSavedIds = asyncHandler(async (req, res) => {
  const lists = await FavoriteList.find({
    isDeleted: false,
    $or: [{ owner: req.user._id }, { "collaborators.user": req.user._id }],
  }).select("items.restaurant");
  const ids = new Set();
  lists.forEach((l) => l.items.forEach((it) => ids.add(it.restaurant.toString())));
  res.json({ success: true, data: { ids: [...ids] } });
});

export {
  listMyLists,
  createList,
  getList,
  updateList,
  deleteList,
  addItem,
  removeItem,
  toggleFavorite,
  getSavedIds,
};
