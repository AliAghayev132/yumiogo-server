import { Report, Review, User, Restaurant, FavoriteList } from "#models";
import { reportStatuses, reportTargetTypes, reportActions } from "#constants";
import { ReviewService, CatalogService, ModerationService } from "#services";
import { asyncHandler, escapeRegex } from "#utils";

/**
 * Admin Reports queue: one mixed table (status / type / reason filters),
 * report detail with a preview of the reported item, resolve / dismiss with a
 * resolution note and optional enforcement on reviews, reporter notification,
 * delete and CSV export. Mounted under /api/admin (admin only).
 */

const { isObjectId, publicUser } = ReviewService;
const { cleanName } = CatalogService;
const EXPORT_LIMIT = 5000;

const badRequest = (res, message) => res.status(400).json({ success: false, message });
const notFound = (res, message = "Report not found") =>
  res.status(404).json({ success: false, message });

const pageParams = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};
const pagination = ({ page, limit }, total) => ({ page, limit, total, pages: Math.ceil(total / limit) });

const fullName = (u) => `${u?.firstName || ""} ${u?.lastName || ""}`.trim();

/**
 * Filter from ?status= (open|in_review|resolved|dismissed|active = open+in_review)
 * &type= &reason= &search= ("#201", reason / label / description text, reporter name).
 */
const buildFilter = async (query) => {
  const filter = {};
  if (query.status && query.status !== "all") {
    if (query.status === "active") filter.status = { $in: ["open", "in_review"] };
    else if (reportStatuses.includes(query.status)) filter.status = query.status;
    else return { error: "Invalid status" };
  }
  if (query.type && query.type !== "all") {
    if (!reportTargetTypes.includes(query.type)) return { error: "Invalid type" };
    filter.targetType = query.type;
  }
  if (query.reason) filter.reason = cleanName(query.reason);

  const search = cleanName(query.search);
  if (search) {
    const number = /^#?(\d{1,9})$/.exec(search);
    if (number) {
      filter.number = Number(number[1]);
    } else {
      const rx = { $regex: escapeRegex(search), $options: "i" };
      const reporters = await User.find({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] }, "_id")
        .limit(200)
        .lean();
      filter.$or = [
        { reason: rx },
        { targetLabel: rx },
        { description: rx },
        { reporter: { $in: reporters.map((u) => u._id) } },
      ];
    }
  }
  return { filter };
};

/**
 * Previews of the reported items, keyed "<type>:<id>".
 * review → { number, sentiment, comment, photos, status, isDeleted, author, restaurant }
 * user → { name, avatar, email, status, isDeleted }; restaurant → { name, coverImage, status, isDeleted }
 * list → { name, privacy, itemCount, owner, isDeleted }
 */
const loadTargets = async (reports) => {
  const idsOf = (type) => reports.filter((r) => r.targetType === type).map((r) => r.targetId);
  const [reviews, users, restaurants, lists] = await Promise.all([
    Review.find({ _id: { $in: idsOf("review") } })
      .populate("user", "firstName lastName avatar verified status isDeleted")
      .populate("restaurant", "name coverImages")
      .lean(),
    User.find({ _id: { $in: idsOf("user") } }, "firstName lastName avatar verified email status isDeleted").lean(),
    Restaurant.find({ _id: { $in: idsOf("restaurant") } }, "name coverImages address status isDeleted").lean(),
    FavoriteList.find({ _id: { $in: idsOf("list") } }, "name privacy items owner isDeleted")
      .populate("owner", "firstName lastName avatar verified")
      .lean(),
  ]);

  const map = new Map();
  reviews.forEach((r) =>
    map.set(`review:${r._id}`, {
      _id: r._id,
      number: r.number ?? null,
      sentiment: r.sentiment,
      score: r.score,
      comment: r.comment || "",
      photos: r.photos || [],
      status: r.status || "approved",
      isDeleted: !!r.isDeleted,
      author: r.user ? { ...publicUser(r.user), status: r.user.status, isDeleted: !!r.user.isDeleted } : null,
      restaurant: r.restaurant ? { _id: r.restaurant._id, name: r.restaurant.name, coverImage: r.restaurant.coverImages?.[0] || null } : null,
      createdAt: r.createdAt,
    }),
  );
  users.forEach((u) =>
    map.set(`user:${u._id}`, {
      _id: u._id,
      name: fullName(u),
      avatar: u.avatar ?? null,
      verified: !!u.verified,
      email: u.email,
      status: u.status,
      isDeleted: !!u.isDeleted,
    }),
  );
  restaurants.forEach((r) =>
    map.set(`restaurant:${r._id}`, {
      _id: r._id,
      name: r.name,
      coverImage: r.coverImages?.[0] || null,
      address: r.address || "",
      status: r.status,
      isDeleted: !!r.isDeleted,
    }),
  );
  lists.forEach((l) =>
    map.set(`list:${l._id}`, {
      _id: l._id,
      name: l.name,
      privacy: l.privacy,
      itemCount: l.items?.length || 0,
      owner: l.owner ? publicUser(l.owner) : null,
      isDeleted: !!l.isDeleted,
    }),
  );
  return map;
};

const toAdmin = (report, targets = new Map()) => ({
  _id: report._id,
  number: report.number ?? null,
  targetType: report.targetType,
  targetId: report.targetId,
  targetLabel: report.targetLabel || "",
  target: targets.get(`${report.targetType}:${report.targetId}`) || null,
  reason: report.reason,
  description: report.description || "",
  // null = system report ("System" in the table).
  reporter: report.reporter ? publicUser(report.reporter) : null,
  status: report.status,
  resolutionNote: report.resolutionNote || "",
  action: report.action || "none",
  resolvedBy: report.resolvedBy ? publicUser(report.resolvedBy) : null,
  resolvedAt: report.resolvedAt ?? null,
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
});

const populateReport = (query) =>
  query
    .populate("reporter", "firstName lastName avatar verified")
    .populate("resolvedBy", "firstName lastName avatar verified");

const statusCounts = async () => {
  const rows = await Report.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  const counts = { all: 0, open: 0, in_review: 0, resolved: 0, dismissed: 0 };
  rows.forEach((row) => {
    counts[row._id] = (counts[row._id] || 0) + row.count;
    counts.all += row.count;
  });
  return counts;
};

/**
 * List reports (all statuses by default, newest first).
 * GET /api/admin/reports?page=&limit=&status=open|in_review|resolved|dismissed|active&type=&reason=&search=
 * → { reports, pagination, counts: { all, open, in_review, resolved, dismissed } }
 */
const listReports = asyncHandler(async (req, res) => {
  const { filter, error } = await buildFilter(req.query);
  if (error) return badRequest(res, error);
  const params = pageParams(req.query);

  const [reports, total, counts] = await Promise.all([
    populateReport(Report.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit)).lean(),
    Report.countDocuments(filter),
    statusCounts(),
  ]);
  const targets = await loadTargets(reports);

  res.json({
    success: true,
    data: {
      reports: reports.map((r) => toAdmin(r, targets)),
      pagination: pagination(params, total),
      counts,
    },
  });
});

/**
 * One report with the reported item and the other reports on it.
 * GET /api/admin/reports/:id → { report, related: [{ _id, number, reason, status, reporter, createdAt }] }
 */
const getReport = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const report = await populateReport(Report.findById(req.params.id)).lean();
  if (!report) return notFound(res);
  const [targets, related] = await Promise.all([
    loadTargets([report]),
    Report.find({ targetType: report.targetType, targetId: report.targetId, _id: { $ne: report._id } })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("reporter", "firstName lastName avatar verified")
      .lean(),
  ]);
  res.json({
    success: true,
    data: {
      report: toAdmin(report, targets),
      related: related.map((r) => ({
        _id: r._id,
        number: r.number ?? null,
        reason: r.reason,
        status: r.status,
        reporter: r.reporter ? publicUser(r.reporter) : null,
        createdAt: r.createdAt,
      })),
    },
  });
});

// What the reporter is told when the report is closed.
const reporterMessage = (report, status, note) => {
  const about = report.targetLabel || `a ${report.targetType}`;
  const suffix = note ? ` Note from our team: ${note}` : "";
  return status === "resolved"
    ? `Your report about ${about} was reviewed and action was taken.${suffix}`
    : `Your report about ${about} was reviewed. No action was taken.${suffix}`;
};

/**
 * Change a report's status. Resolving can enforce on a reported review
 * (hide_review → review rejected, delete_review → review removed; both
 * recompute the rating, notify the author and settle the review's other open
 * reports) or list (remove_list → list removed, owner notified, its other open
 * reports closed). Resolve / dismiss notify the reporter unless notifyReporter=false.
 * PATCH /api/admin/reports/:id { status, resolutionNote?, action?: none|hide_review|delete_review|remove_list, notifyReporter? }
 * → { report }
 */
const updateReport = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const report = await Report.findById(req.params.id);
  if (!report) return notFound(res);

  const { status } = req.body || {};
  if (!reportStatuses.includes(status)) {
    return badRequest(res, `status must be one of: ${reportStatuses.join(", ")}`);
  }
  const action = req.body?.action || "none";
  if (!reportActions.includes(action)) return badRequest(res, `action must be one of: ${reportActions.join(", ")}`);
  if (action === "remove_list") {
    if (status !== "resolved" || report.targetType !== "list") {
      return badRequest(res, "List actions can only be applied when resolving a list report");
    }
  } else if (action !== "none" && (status !== "resolved" || report.targetType !== "review")) {
    return badRequest(res, "Review actions can only be applied when resolving a review report");
  }
  const note = String(req.body?.resolutionNote ?? req.body?.note ?? "").trim().slice(0, 500);
  const closing = ["resolved", "dismissed"].includes(status);
  const wasClosed = ["resolved", "dismissed"].includes(report.status);

  // Enforcement on the reported list.
  if (action === "remove_list") {
    const list = await FavoriteList.findOne({ _id: report.targetId, isDeleted: false });
    if (!list) return badRequest(res, "The reported list no longer exists");
    await ModerationService.removeList(list, {
      actor: req.user,
      reason: note || report.reason,
      exceptReport: report._id,
    });
  }

  // Enforcement on the reported review.
  if (action !== "none" && action !== "remove_list") {
    const review = await Review.findOne({ _id: report.targetId, isDeleted: false }).populate("restaurant", "name");
    if (!review) return badRequest(res, "The reported review no longer exists");
    const place = review.restaurant?.name || "a restaurant";
    const reason = note || report.reason;
    if (action === "hide_review") {
      await ReviewService.setStatus(review, "rejected", { by: req.user._id, note: reason });
      await ReviewService.notify({
        recipient: review.user,
        type: "system",
        title: "Review hidden",
        message: `Your review of ${place} was hidden. Reason: ${reason}`,
        review: review._id,
        restaurant: review.restaurant,
        data: { reviewStatus: "rejected" },
      });
    } else {
      await ReviewService.removeReview(review, { by: req.user._id, reason, byAdmin: false });
      await ReviewService.notify({
        recipient: review.user,
        type: "system",
        title: "Review removed",
        message: `Your review of ${place} was removed. Reason: ${reason}`,
        restaurant: review.restaurant,
        data: { reviewStatus: "deleted" },
      });
    }
    await ReviewService.closeReportsFor(review, {
      by: req.user._id,
      action,
      note: note || "Action was taken on the reported review.",
      except: report._id,
    });
  }

  report.status = status;
  report.action = closing ? action : "none";
  if (note || closing) report.resolutionNote = note;
  report.resolvedBy = closing ? req.user._id : null;
  report.resolvedAt = closing ? new Date() : null;
  await report.save();

  const notifyReporter = req.body?.notifyReporter !== false && req.body?.notifyReporter !== "false";
  if (closing && !wasClosed && notifyReporter && report.reporter) {
    await ReviewService.notify({
      recipient: report.reporter,
      type: "system",
      title: "Report reviewed",
      message: reporterMessage(report, status, note),
      data: { reportId: String(report._id), reportStatus: status },
    });
  }

  const fresh = await populateReport(Report.findById(report._id)).lean();
  const targets = await loadTargets([fresh]);
  const label = status === "in_review" ? "marked in review" : status === "open" ? "reopened" : status;
  res.json({
    success: true,
    message: `Report #${report.number} ${label}${closing && notifyReporter && report.reporter && !wasClosed ? " — reporter notified" : ""}`,
    data: { report: toAdmin(fresh, targets) },
  });
});

/**
 * Delete a report.
 * DELETE /api/admin/reports/:id → { report: { _id, number } }
 */
const deleteReport = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const report = await Report.findByIdAndDelete(req.params.id);
  if (!report) return notFound(res);
  res.json({
    success: true,
    message: `Report #${report.number} deleted`,
    data: { report: { _id: report._id, number: report.number } },
  });
});

const csvCell = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Download the filtered reports as CSV (same query as the list).
 * GET /api/admin/reports/export?... → text/csv
 */
const exportReports = asyncHandler(async (req, res) => {
  const { filter, error } = await buildFilter(req.query);
  if (error) return badRequest(res, error);
  const reports = await populateReport(Report.find(filter).sort({ createdAt: -1 }).limit(EXPORT_LIMIT)).lean();
  const header = ["Number", "Reported by", "Type", "Target", "Reason", "Description", "Status", "Resolution note", "Action", "Created", "Resolved"];
  const rows = reports.map((r) => [
    r.number,
    r.reporter ? fullName(r.reporter) : "System",
    r.targetType,
    r.targetLabel,
    r.reason,
    r.description,
    r.status,
    r.resolutionNote,
    r.action,
    new Date(r.createdAt).toISOString(),
    r.resolvedAt ? new Date(r.resolvedAt).toISOString() : "",
  ]);
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="reports-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${body}`);
});

export { listReports, getReport, updateReport, deleteReport, exportReports };
