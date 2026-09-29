import { FavoriteList, Report, User } from "#models";
import { favoritePrivacy } from "#constants";
import { ModerationService } from "#services";
import { asyncHandler, escapeRegex } from "#utils";

/**
 * Admin — favourite lists (moderation). Public and collaborative lists show
 * up in feeds and share links, so the admin can find, inspect and remove them.
 *
 *   GET    /api/admin/lists?page&limit&search&privacy&owner&deleted=true
 *   GET    /api/admin/lists/:id
 *   DELETE /api/admin/lists/:id { reason? }   (also ?reason=)
 */

const OWNER_FIELDS = "firstName lastName email avatar status isDeleted";
const RESTAURANT_FIELDS = "name coverImages address city isDeleted status";

const badRequest = (res, message) => res.status(400).json({ success: false, message });
const notFound = (res) => res.status(404).json({ success: false, message: "List not found", code: "LIST_NOT_FOUND" });

const pageParams = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const toAdmin = (list, openReports = 0) => ({
  _id: list._id,
  name: list.name,
  privacy: list.privacy,
  isDefault: !!list.isDefault,
  shareSlug: list.privacy === "private" ? null : list.shareSlug,
  owner: list.owner
    ? {
        _id: list.owner._id,
        firstName: list.owner.firstName,
        lastName: list.owner.lastName,
        email: list.owner.email,
        avatar: list.owner.avatar || null,
        status: list.owner.status,
        isDeleted: !!list.owner.isDeleted,
      }
    : null,
  itemCount: (list.items || []).length,
  saveCount: (list.followers || []).length,
  collaboratorCount: (list.collaborators || []).length,
  openReports,
  isDeleted: !!list.isDeleted,
  deletedAt: list.deletedAt || null,
  createdAt: list.createdAt,
  updatedAt: list.updatedAt,
});

const openReportCounts = async (ids) => {
  if (!ids.length) return new Map();
  const rows = await Report.aggregate([
    { $match: { targetType: "list", targetId: { $in: ids }, status: { $in: ["open", "in_review"] } } },
    { $group: { _id: "$targetId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

/**
 * GET /api/admin/lists → { lists, pagination, counts: { all, public, collaborative, private, deleted } }
 * search: list name or owner name / email.
 */
const listLists = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const deleted = req.query.deleted === "true";
  const filter = { isDeleted: deleted };

  const privacy = String(req.query.privacy || "");
  if (privacy && privacy !== "all") {
    if (!favoritePrivacy.includes(privacy)) {
      return badRequest(res, `privacy must be one of: all, ${favoritePrivacy.join(", ")}`);
    }
    filter.privacy = privacy;
  }
  if (req.query.owner) {
    if (!/^[a-f0-9]{24}$/i.test(String(req.query.owner))) return badRequest(res, "Invalid owner id");
    filter.owner = req.query.owner;
  }
  const search = String(req.query.search || "").trim().slice(0, 100);
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    const owners = await User.distinct("_id", { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] });
    filter.$or = [{ name: rx }, { owner: { $in: owners } }];
  }

  const [lists, total, counts] = await Promise.all([
    FavoriteList.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("owner", OWNER_FIELDS)
      .lean(),
    FavoriteList.countDocuments(filter),
    FavoriteList.aggregate([
      { $group: { _id: { deleted: "$isDeleted", privacy: "$privacy" }, count: { $sum: 1 } } },
    ]),
  ]);
  const reports = await openReportCounts(lists.map((l) => l._id));
  const count = { all: 0, public: 0, collaborative: 0, private: 0, deleted: 0 };
  counts.forEach(({ _id, count: n }) => {
    if (_id.deleted) {
      count.deleted += n;
      return;
    }
    count.all += n;
    if (_id.privacy in count) count[_id.privacy] += n;
  });

  res.json({
    success: true,
    data: {
      lists: lists.map((l) => toAdmin(l, reports.get(String(l._id)) || 0)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      counts: count,
    },
  });
});

/** GET /api/admin/lists/:id → { list (+ items, collaborators), reports } */
const getList = asyncHandler(async (req, res) => {
  const list = await FavoriteList.findById(req.params.id)
    .populate("owner", OWNER_FIELDS)
    .populate("items.restaurant", RESTAURANT_FIELDS)
    .populate("collaborators.user", "firstName lastName avatar")
    .lean();
  if (!list) return notFound(res);
  const reports = await Report.find({ targetType: "list", targetId: list._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate("reporter", "firstName lastName")
    .lean();
  const open = reports.filter((r) => ["open", "in_review"].includes(r.status)).length;

  res.json({
    success: true,
    data: {
      list: {
        ...toAdmin(list, open),
        items: (list.items || []).map((item) => ({
          restaurant: item.restaurant
            ? {
                _id: item.restaurant._id,
                name: item.restaurant.name,
                coverImage: item.restaurant.coverImages?.[0] || null,
                address: item.restaurant.address,
                city: item.restaurant.city,
                isDeleted: !!item.restaurant.isDeleted,
                status: item.restaurant.status,
              }
            : null,
          savedAt: item.savedAt || null,
        })),
        collaborators: (list.collaborators || []).map((c) => ({
          user: c.user ? { _id: c.user._id, firstName: c.user.firstName, lastName: c.user.lastName, avatar: c.user.avatar || null } : null,
          role: c.role,
        })),
      },
      reports: reports.map((r) => ({
        _id: r._id,
        number: r.number,
        reason: r.reason,
        description: r.description,
        status: r.status,
        reporter: r.reporter ? { _id: r.reporter._id, firstName: r.reporter.firstName, lastName: r.reporter.lastName } : null,
        createdAt: r.createdAt,
      })),
    },
  });
});

/** DELETE /api/admin/lists/:id { reason? } → { list: { _id, name }, summary: { lists, reports } } */
const removeList = asyncHandler(async (req, res) => {
  const list = await FavoriteList.findById(req.params.id);
  if (!list) return notFound(res);
  const reason = String(req.body?.reason ?? req.query.reason ?? "").trim().slice(0, 500);
  const summary = await ModerationService.removeList(list, { actor: req.user, reason });
  res.json({
    success: true,
    message: `"${list.name}" was removed — owner notified`,
    data: { list: { _id: list._id, name: list.name }, summary },
  });
});

export { listLists, getList, removeList };
