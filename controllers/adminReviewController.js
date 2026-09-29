import { Review, Report, User, Restaurant, Comment, Taxonomy, ReviewLabelRequest } from "#models";
import { reviewStatuses, reviewReactions, labelRequestStatuses } from "#constants";
import { ReviewService, CatalogService } from "#services";
import { asyncHandler, escapeRegex } from "#utils";

/**
 * Admin review moderation (Reviews page), review labels and label requests.
 * Mounted under /api/admin — every route already requires an admin.
 */

const { isObjectId, publicUser } = ReviewService;
const { cleanName, toBool, toNumber } = CatalogService;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const EXPORT_LIMIT = 5000;

const badRequest = (res, message) => res.status(400).json({ success: false, message });
const notFound = (res, message = "Review not found") =>
  res.status(404).json({ success: false, message });

const pageParams = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};
const pagination = ({ page, limit }, total) => ({ page, limit, total, pages: Math.ceil(total / limit) });

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  rating_high: { score: -1, createdAt: -1 },
  rating_low: { score: 1, createdAt: -1 },
  popular: { likeCount: -1, createdAt: -1 },
};

// "#4821" / "4821" → 4821
const searchNumber = (value) => {
  const match = /^#?(\d{1,9})$/.exec(String(value).trim());
  return match ? Number(match[1]) : null;
};

/**
 * Build the admin review filter from the query:
 * status, sentiment, restaurant, user, search (text, "#number", author or
 * restaurant name), from/to (createdAt). → { filter } | { error }
 */
const buildFilter = async (query) => {
  const filter = { isDeleted: false };
  if (query.status && query.status !== "all") {
    if (!reviewStatuses.includes(query.status)) return { error: "Invalid status" };
    filter.status = query.status;
  }
  if (query.sentiment) {
    if (!reviewReactions.includes(query.sentiment)) return { error: "Invalid sentiment" };
    filter.sentiment = query.sentiment;
  }
  if (query.restaurant) {
    if (!isObjectId(query.restaurant)) return { error: "Invalid restaurant" };
    filter.restaurant = query.restaurant;
  }
  if (query.user) {
    if (!isObjectId(query.user)) return { error: "Invalid user" };
    filter.user = query.user;
  }
  const range = {};
  if (query.from && !Number.isNaN(new Date(query.from).getTime())) range.$gte = new Date(query.from);
  if (query.to && !Number.isNaN(new Date(query.to).getTime())) range.$lte = new Date(query.to);
  if (Object.keys(range).length) filter.createdAt = range;

  const search = cleanName(query.search);
  if (search) {
    const number = searchNumber(search);
    if (number !== null) {
      filter.number = number;
    } else {
      const rx = { $regex: escapeRegex(search), $options: "i" };
      const [users, restaurants] = await Promise.all([
        User.find({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] }, "_id").limit(200).lean(),
        Restaurant.find({ name: rx }, "_id").limit(200).lean(),
      ]);
      filter.$or = [
        { comment: rx },
        { labels: rx },
        { user: { $in: users.map((u) => u._id) } },
        { restaurant: { $in: restaurants.map((r) => r._id) } },
      ];
    }
  }
  return { filter };
};

const populateAdmin = (query) =>
  query
    .populate("user", "firstName lastName avatar verified email status isDeleted")
    .populate("restaurant", "name coverImages address isDeleted")
    .populate("companions", "firstName lastName avatar verified")
    .populate("moderatedBy", "firstName lastName");

/** Review → admin table/detail shape. */
const toAdmin = (review, reportCounts = new Map()) => {
  const r = typeof review.toObject === "function" ? review.toObject() : review;
  return {
    _id: r._id,
    number: r.number ?? null,
    user: r.user
      ? { ...publicUser(r.user), email: r.user.email, status: r.user.status, isDeleted: !!r.user.isDeleted }
      : null,
    restaurant: r.restaurant
      ? { _id: r.restaurant._id, name: r.restaurant.name, coverImages: r.restaurant.coverImages || [], isDeleted: !!r.restaurant.isDeleted }
      : null,
    sentiment: r.sentiment,
    score: r.score,
    comment: r.comment || "",
    photos: r.photos || [],
    companions: (r.companions || []).map(publicUser).filter(Boolean),
    labels: r.labels || [],
    favoriteDishes: (r.favoriteDishes || []).map((d) => ({ name: d.name, menuItem: d.menuItem ?? null })),
    visitDate: r.visitDate ?? null,
    isStealth: !!r.isStealth,
    status: r.status || "approved",
    moderationNote: r.moderationNote || "",
    moderatedBy: r.moderatedBy ? publicUser(r.moderatedBy) : null,
    moderatedAt: r.moderatedAt ?? null,
    likeCount: r.likeCount || 0,
    commentCount: r.commentCount || 0,
    shareCount: r.shareCount || 0,
    viewCount: r.viewCount || 0,
    openReports: reportCounts.get(String(r._id)) || 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
};

// Open / in-review report counts per review id.
const openReportCounts = async (reviewIds) => {
  if (!reviewIds.length) return new Map();
  const rows = await Report.aggregate([
    { $match: { targetType: "review", targetId: { $in: reviewIds }, status: { $in: ["open", "in_review"] } } },
    { $group: { _id: "$targetId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

// Tab badges: live reviews per status.
const statusCounts = async () => {
  const rows = await Review.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const counts = { all: 0, pending: 0, approved: 0, flagged: 0, rejected: 0 };
  rows.forEach((row) => {
    const key = row._id || "approved";
    counts[key] = (counts[key] || 0) + row.count;
    counts.all += row.count;
  });
  return counts;
};

/**
 * List reviews for moderation.
 * GET /api/admin/reviews?page=&limit=&status=pending|approved|flagged|rejected&sentiment=
 *     &restaurant=&user=&search=&from=&to=&sort=newest|oldest|rating_high|rating_low|popular
 * → { reviews, pagination, counts: { all, pending, approved, flagged, rejected } }
 */
const listReviews = asyncHandler(async (req, res) => {
  const { filter, error } = await buildFilter(req.query);
  if (error) return badRequest(res, error);
  const params = pageParams(req.query);
  const sort = SORTS[req.query.sort] || SORTS.newest;

  const [reviews, total, counts] = await Promise.all([
    populateAdmin(Review.find(filter).sort(sort).skip(params.skip).limit(params.limit)),
    Review.countDocuments(filter),
    statusCounts(),
  ]);
  const reportCounts = await openReportCounts(reviews.map((r) => r._id));

  res.json({
    success: true,
    data: {
      reviews: reviews.map((r) => toAdmin(r, reportCounts)),
      pagination: pagination(params, total),
      counts,
    },
  });
});

// CSV cell (quotes, and a leading ' against spreadsheet formula injection).
const csvCell = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const sendCsv = (res, filename, header, rows) => {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`﻿${body}`);
};

/**
 * Download the filtered review list as CSV (same query as the list).
 * GET /api/admin/reviews/export?... → text/csv
 */
const exportReviews = asyncHandler(async (req, res) => {
  const { filter, error } = await buildFilter(req.query);
  if (error) return badRequest(res, error);
  const reviews = await populateAdmin(
    Review.find(filter).sort(SORTS[req.query.sort] || SORTS.newest).limit(EXPORT_LIMIT),
  );
  const rows = reviews.map((doc) => {
    const r = toAdmin(doc);
    return [
      r.number,
      r.user ? `${r.user.firstName} ${r.user.lastName}` : "",
      r.user?.email || "",
      r.restaurant?.name || "",
      r.sentiment,
      r.score,
      r.status,
      r.comment,
      r.labels.join("; "),
      r.likeCount,
      r.commentCount,
      r.visitDate ? new Date(r.visitDate).toISOString().slice(0, 10) : "",
      new Date(r.createdAt).toISOString(),
    ];
  });
  sendCsv(
    res,
    `reviews-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Number", "User", "Email", "Restaurant", "Sentiment", "Rating", "Status", "Review", "Labels", "Likes", "Comments", "Visit date", "Created"],
    rows,
  );
});

/**
 * One review with its reports and comment count.
 * GET /api/admin/reviews/:id → { review, reports: [...] }
 */
const getReview = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const review = await populateAdmin(Review.findById(req.params.id));
  if (!review) return notFound(res);
  const reports = await Report.find({ targetType: "review", targetId: review._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("reporter", "firstName lastName avatar")
    .lean();
  const reportCounts = await openReportCounts([review._id]);
  res.json({
    success: true,
    data: {
      review: { ...toAdmin(review, reportCounts), isDeleted: !!review.isDeleted },
      reports: reports.map((r) => ({
        _id: r._id,
        number: r.number ?? null,
        reason: r.reason,
        description: r.description,
        status: r.status,
        reporter: r.reporter ? publicUser(r.reporter) : null,
        createdAt: r.createdAt,
      })),
    },
  });
});

// Author notifications per moderation outcome.
const STATUS_TITLES = {
  approved: "Review approved",
  flagged: "Review flagged",
  rejected: "Review not published",
};
const STATUS_MESSAGES = {
  approved: (place) => `Your review of ${place} was approved and is now public.`,
  flagged: (place) => `Your review of ${place} was flagged and is being checked by our team.`,
  rejected: (place, reason) =>
    `Your review of ${place} was not published.${reason ? ` Reason: ${reason}` : ""}`,
};

/**
 * Approve / flag / reject (hide) a review, or send it back to pending.
 * Notifies the author and recomputes the restaurant rating.
 * PATCH /api/admin/reviews/:id { status, reason? } → { review }
 */
const updateReviewStatus = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const { status } = req.body || {};
  if (!reviewStatuses.includes(status)) {
    return badRequest(res, `status must be one of: ${reviewStatuses.join(", ")}`);
  }
  const reason = String(req.body?.reason ?? "").trim().slice(0, 500);

  const review = await Review.findOne({ _id: req.params.id, isDeleted: false }).populate("restaurant", "name");
  if (!review) return notFound(res);

  await ReviewService.setStatus(review, status, { by: req.user._id, note: reason });

  // Hiding a review settles its open reports.
  if (status === "rejected") {
    await ReviewService.closeReportsFor(review, {
      by: req.user._id,
      action: "hide_review",
      note: reason || "The review was hidden.",
    });
  }

  const message = STATUS_MESSAGES[status]?.(review.restaurant?.name || "a restaurant", reason);
  if (message) {
    await ReviewService.notify({
      recipient: review.user,
      type: "system",
      title: STATUS_TITLES[status],
      message,
      review: review._id,
      restaurant: review.restaurant,
      data: { reviewStatus: status },
    });
  }

  const fresh = await populateAdmin(Review.findById(review._id));
  const reportCounts = await openReportCounts([review._id]);
  res.json({
    success: true,
    message: `Review #${review.number} ${status === "pending" ? "moved to pending" : status}${message ? " — user notified" : ""}`,
    data: { review: toAdmin(fresh, reportCounts) },
  });
});

/**
 * Delete a review (soft) with a reason: recomputes the restaurant rating,
 * resolves its open reports and notifies the author.
 * DELETE /api/admin/reviews/:id  body or query { reason? } → { review: { _id, number } }
 */
const deleteReview = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const review = await Review.findOne({ _id: req.params.id, isDeleted: false }).populate("restaurant", "name");
  if (!review) return notFound(res);
  const reason = String(req.body?.reason ?? req.query.reason ?? "").trim().slice(0, 500);

  await ReviewService.removeReview(review, { by: req.user._id, reason, byAdmin: true });
  await ReviewService.notify({
    recipient: review.user,
    type: "system",
    title: "Review removed",
    message: `Your review of ${review.restaurant?.name || "a restaurant"} was removed.${reason ? ` Reason: ${reason}` : ""}`,
    restaurant: review.restaurant,
    data: { reviewStatus: "deleted" },
  });

  res.json({
    success: true,
    message: `Review #${review.number} deleted — user notified`,
    data: { review: { _id: review._id, number: review.number } },
  });
});

/**
 * Recalculate restaurant ratings from the reviews (one restaurant or all).
 * POST /api/admin/reviews/recompute { restaurant? }
 * → { restaurants, updated } | { restaurant, summary }
 */
const recompute = asyncHandler(async (req, res) => {
  const restaurant = req.body?.restaurant || req.query.restaurant;
  if (restaurant) {
    if (!isObjectId(restaurant)) return badRequest(res, "Invalid restaurant");
    if (!(await Restaurant.exists({ _id: restaurant }))) return notFound(res, "Restaurant not found");
    const summary = await ReviewService.recomputeRestaurant(restaurant);
    return res.json({ success: true, message: "Rating recalculated", data: { restaurant, summary } });
  }
  const result = await ReviewService.recomputeAll();
  res.json({ success: true, message: "Ratings recalculated", data: result });
});

// ======================================================================
// Review labels (catalog type "reviewLabel" with a group heading)
// ======================================================================

/** Validate label fields present in `body`. → { fields } | { error } */
const labelFields = (body) => {
  const fields = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return { error: "Name is required" };
    if (name.length > 60) return { error: "Name must be at most 60 characters" };
    fields.name = name;
  }
  if (body.group !== undefined) {
    const group = cleanName(body.group);
    if (group.length > 40) return { error: "Group must be at most 40 characters" };
    fields.group = group;
  }
  ["icon", "emoji"].forEach((key) => {
    if (body[key] !== undefined) fields[key] = cleanName(body[key]) || null;
  });
  if (body.color !== undefined) {
    const color = cleanName(body.color) || null;
    if (color && !HEX_COLOR.test(color)) return { error: "Colour must be a hex value like #22C55E" };
    fields.color = color;
  }
  if (body.description !== undefined) fields.description = String(body.description ?? "").trim();
  if (body.order !== undefined) {
    const order = toNumber(body.order);
    if (order === null) return { error: "Order must be a number" };
    fields.order = order;
  }
  if (body.isActive !== undefined) fields.isActive = toBool(body.isActive);
  return { fields };
};

const labelNameTaken = (name, exceptId = null) =>
  Taxonomy.exists({
    type: "reviewLabel",
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });

const toLabel = (item, counts = {}) => ({
  ...CatalogService.toItem(item),
  isActive: item.isActive,
  usageCount: counts[item.name] || 0,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

// Create a reviewLabel catalog item at the end of the list.
const createLabelItem = async (fields) => {
  const siblings = await Taxonomy.find({ type: "reviewLabel" }, "slug order").lean();
  const slugs = new Set(siblings.map((s) => s.slug));
  const order = siblings.reduce((max, s) => Math.max(max, s.order ?? 0), -1) + 1;
  return Taxonomy.create({
    order,
    ...fields,
    type: "reviewLabel",
    slug: CatalogService.uniqueSlug(fields.name, slugs),
  });
};

/**
 * All review labels (incl. inactive) with usage counts and the group list.
 * GET /api/admin/review-labels?search=&group= → { items, groups }
 */
const listLabels = asyncHandler(async (req, res) => {
  const filter = { type: "reviewLabel" };
  const search = cleanName(req.query.search);
  if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };
  if (req.query.group !== undefined) filter.group = cleanName(req.query.group);
  const [items, counts, groups] = await Promise.all([
    Taxonomy.find(filter).sort({ order: 1, name: 1 }).lean(),
    CatalogService.usageCounts("reviewLabel"),
    Taxonomy.distinct("group", { type: "reviewLabel" }),
  ]);
  res.json({
    success: true,
    data: { items: items.map((item) => toLabel(item, counts)), groups: groups.filter(Boolean) },
  });
});

/**
 * Create a review label.
 * POST /api/admin/review-labels { name, group?, emoji?, icon?, color?, description?, order?, isActive? }
 * → 201 { item }
 */
const createLabel = asyncHandler(async (req, res) => {
  if (req.body?.name === undefined) return badRequest(res, "Name is required");
  const { fields, error } = labelFields(req.body);
  if (error) return badRequest(res, error);
  if (await labelNameTaken(fields.name)) {
    return res.status(409).json({ success: false, message: `"${fields.name}" already exists` });
  }
  const item = await createLabelItem(fields);
  res.status(201).json({ success: true, message: "Label created", data: { item: toLabel(item.toObject()) } });
});

/**
 * Update a review label; a rename cascades into existing reviews.
 * PUT /api/admin/review-labels/:id → { item, cascaded }
 */
const updateLabel = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "Label not found");
  const item = await Taxonomy.findOne({ _id: req.params.id, type: "reviewLabel" });
  if (!item) return notFound(res, "Label not found");
  const { fields, error } = labelFields(req.body || {});
  if (error) return badRequest(res, error);

  const oldName = item.name;
  if (fields.name && fields.name !== oldName && (await labelNameTaken(fields.name, item._id))) {
    return res.status(409).json({ success: false, message: `"${fields.name}" already exists` });
  }
  item.set(fields);
  await item.save();
  const cascaded = fields.name ? await CatalogService.cascadeRename("reviewLabel", oldName, item.name) : 0;
  const counts = await CatalogService.usageCounts("reviewLabel");
  res.json({ success: true, message: "Label updated", data: { item: toLabel(item.toObject(), counts), cascaded } });
});

/**
 * Delete a review label (removed from existing reviews too).
 * DELETE /api/admin/review-labels/:id → { removedFrom }
 */
const deleteLabel = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "Label not found");
  const item = await Taxonomy.findOne({ _id: req.params.id, type: "reviewLabel" });
  if (!item) return notFound(res, "Label not found");
  const removedFrom = await CatalogService.cascadeDelete("reviewLabel", item.name);
  await item.deleteOne();
  res.json({ success: true, message: "Label deleted", data: { removedFrom } });
});

// ======================================================================
// Label requests ("Request a label" from the app)
// ======================================================================

const toRequest = (r) => ({
  _id: r._id,
  label: r.label,
  group: r.group || "",
  status: r.status,
  adminNote: r.adminNote || "",
  user: r.user ? publicUser(r.user) : null,
  taxonomy: r.taxonomy || null,
  reviewedBy: r.reviewedBy ? publicUser(r.reviewedBy) : null,
  reviewedAt: r.reviewedAt ?? null,
  createdAt: r.createdAt,
});

/**
 * Label ideas sent by users.
 * GET /api/admin/review-labels/requests?status=pending|approved|rejected&search=&page=&limit=
 * → { requests, pagination, counts: { all, pending, approved, rejected } }
 */
const listLabelRequests = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status && req.query.status !== "all") {
    if (!labelRequestStatuses.includes(req.query.status)) return badRequest(res, "Invalid status");
    filter.status = req.query.status;
  }
  const search = cleanName(req.query.search);
  if (search) filter.label = { $regex: escapeRegex(search), $options: "i" };
  const params = pageParams(req.query);

  const [requests, total, rows] = await Promise.all([
    ReviewLabelRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(params.skip)
      .limit(params.limit)
      .populate("user", "firstName lastName avatar verified")
      .populate("reviewedBy", "firstName lastName avatar verified")
      .lean(),
    ReviewLabelRequest.countDocuments(filter),
    ReviewLabelRequest.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);
  const counts = { all: 0, pending: 0, approved: 0, rejected: 0 };
  rows.forEach((row) => {
    counts[row._id] = row.count;
    counts.all += row.count;
  });

  res.json({
    success: true,
    data: { requests: requests.map(toRequest), pagination: pagination(params, total), counts },
  });
});

/**
 * Approve (creates or re-activates the label) or reject a label idea.
 * PATCH /api/admin/review-labels/requests/:id { status: approved|rejected, name?, group?, note? }
 * → { request, item? }
 */
const reviewLabelRequest = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res, "Request not found");
  const request = await ReviewLabelRequest.findById(req.params.id);
  if (!request) return notFound(res, "Request not found");
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status)) return badRequest(res, "status must be approved or rejected");
  if (request.status !== "pending") return badRequest(res, `This request was already ${request.status}`);
  const note = String(req.body?.note ?? "").trim().slice(0, 300);

  let item = null;
  if (status === "approved") {
    const { fields, error } = labelFields({
      name: req.body?.name ?? request.label,
      group: req.body?.group ?? request.group,
    });
    if (error) return badRequest(res, error);
    item = await Taxonomy.findOne({
      type: "reviewLabel",
      name: { $regex: `^${escapeRegex(fields.name)}$`, $options: "i" },
    });
    if (item) {
      if (!item.isActive) {
        item.isActive = true;
        await item.save();
      }
    } else {
      item = await createLabelItem({ ...fields, isActive: true });
    }
    request.taxonomy = item._id;
  }

  request.status = status;
  request.adminNote = note;
  request.reviewedBy = req.user._id;
  request.reviewedAt = new Date();
  await request.save();

  await ReviewService.notify({
    recipient: request.user,
    type: "system",
    title: status === "approved" ? "Label added" : "Label idea reviewed",
    message:
      status === "approved"
        ? `Your label idea "${item.name}" is now available to everyone. Thanks!`
        : `Your label idea "${request.label}" was not added.${note ? ` ${note}` : ""}`,
    data: { labelRequestId: String(request._id) },
  });

  const fresh = await ReviewLabelRequest.findById(request._id)
    .populate("user", "firstName lastName avatar verified")
    .populate("reviewedBy", "firstName lastName avatar verified")
    .lean();
  res.json({
    success: true,
    message: status === "approved" ? "Label approved — user notified" : "Label request rejected — user notified",
    data: { request: toRequest(fresh), ...(item ? { item: toLabel(item.toObject()) } : {}) },
  });
});

/**
 * Comments of a review for moderation (incl. deleted, newest first). Admins
 * delete a comment with DELETE /api/comments/:id.
 * GET /api/admin/reviews/:id/comments?page=&limit= → { comments, pagination, live }
 */
const listReviewComments = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const params = pageParams(req.query);
  const filter = { review: req.params.id };
  const [comments, total, live] = await Promise.all([
    Comment.find(filter)
      .sort({ createdAt: -1 })
      .skip(params.skip)
      .limit(params.limit)
      .populate("user", "firstName lastName avatar verified")
      .lean(),
    Comment.countDocuments(filter),
    Comment.countDocuments({ ...filter, isDeleted: false }),
  ]);
  res.json({
    success: true,
    data: {
      comments: comments.map((c) => ({
        _id: c._id,
        parent: c.parent,
        user: publicUser(c.user),
        text: c.text,
        isDeleted: !!c.isDeleted,
        likeCount: c.likeCount || 0,
        replyCount: c.replyCount || 0,
        createdAt: c.createdAt,
      })),
      pagination: pagination(params, total),
      live,
    },
  });
});

export {
  listReviews,
  exportReviews,
  getReview,
  updateReviewStatus,
  deleteReview,
  recompute,
  listReviewComments,
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  listLabelRequests,
  reviewLabelRequest,
};
