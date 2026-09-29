import { Report, Review, User, Restaurant, FavoriteList } from "#models";
import { reportTargetTypes } from "#constants";
import { ReviewService, CatalogService } from "#services";
import { asyncHandler } from "#utils";

/**
 * User reports (mobile "Report" action on reviews, users, restaurants and
 * lists) → the admin Reports queue.
 */

const { isObjectId } = ReviewService;
const DESCRIPTION_MAX = 1000;

// `code`: stable error code the apps translate (Accept-Language localizes the message too).
const badRequest = (res, message, code) =>
  res.status(400).json({ success: false, message, ...(code ? { code } : {}) });

const fullName = (u) => `${u?.firstName || ""} ${u?.lastName || ""}`.trim();

/**
 * Load a reportable target. → { label, owner } or { error, status }
 * (targets must exist and not be deleted; you cannot report your own content).
 */
const loadTarget = async (targetType, targetId, reporterId) => {
  const self = String(reporterId);
  switch (targetType) {
    case "review": {
      const review = await Review.findOne({ _id: targetId, isDeleted: false }, "user number restaurant")
        .populate("restaurant", "name")
        .lean();
      if (!review) return { error: "Review not found", status: 404, code: "REVIEW_NOT_FOUND" };
      if (String(review.user) === self) return { error: "You cannot report your own review", code: "REPORT_OWN" };
      const place = review.restaurant?.name ? ` · ${review.restaurant.name}` : "";
      return { label: `Review #${review.number ?? ""}${place}`.trim(), owner: review.user };
    }
    case "user": {
      const user = await User.findOne({ _id: targetId, isDeleted: false }, "firstName lastName").lean();
      if (!user) return { error: "User not found", status: 404, code: "USER_NOT_FOUND" };
      if (String(user._id) === self) return { error: "You cannot report yourself", code: "REPORT_OWN" };
      return { label: fullName(user), owner: user._id };
    }
    case "restaurant": {
      const restaurant = await Restaurant.findOne({ _id: targetId, isDeleted: false }, "name").lean();
      if (!restaurant) return { error: "Restaurant not found", status: 404, code: "RESTAURANT_NOT_FOUND" };
      return { label: restaurant.name, owner: null };
    }
    case "list": {
      const list = await FavoriteList.findOne({ _id: targetId, isDeleted: false }, "name owner privacy").lean();
      if (!list) return { error: "List not found", status: 404, code: "LIST_NOT_FOUND" };
      if (String(list.owner) === self) return { error: "You cannot report your own list", code: "REPORT_OWN" };
      return { label: list.name, owner: list.owner };
    }
    default:
      return { error: "Invalid target type" };
  }
};

/**
 * File a report.
 * POST /api/reports { targetType: review|user|restaurant|list, targetId, reason, description? }
 *   reason = an active reportReason catalog name (GET /api/catalog → reportReasons)
 * → 201 { report: { _id, number, targetType, targetId, reason, status, createdAt } }
 *   409 when you already have an open report on this target.
 */
const createReport = asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.body || {};
  if (!reportTargetTypes.includes(targetType)) {
    return badRequest(res, `targetType must be one of: ${reportTargetTypes.join(", ")}`);
  }
  if (!isObjectId(targetId)) return badRequest(res, "A valid targetId is required");

  const { names } = await CatalogService.resolveNames("reportReason", [req.body.reason ?? ""]);
  if (!names.length) return badRequest(res, "Please choose a reason from the list", "REPORT_REASON_REQUIRED");
  const reason = names[0];

  const description = String(req.body.description ?? "").trim();
  if (description.length > DESCRIPTION_MAX) {
    return badRequest(res, `Description must be at most ${DESCRIPTION_MAX} characters`);
  }

  const target = await loadTarget(targetType, targetId, req.user._id);
  if (target.error) {
    return res
      .status(target.status || 400)
      .json({ success: false, message: target.error, ...(target.code ? { code: target.code } : {}) });
  }

  const duplicate = await Report.exists({
    reporter: req.user._id,
    targetType,
    targetId,
    status: { $in: ["open", "in_review"] },
  });
  if (duplicate) {
    return res
      .status(409)
      .json({ success: false, message: "You have already reported this. We're on it.", code: "REPORT_DUPLICATE" });
  }

  const report = await Report.create({
    targetType,
    targetId,
    targetLabel: target.label,
    targetOwner: target.owner || null,
    reason,
    description,
    reporter: req.user._id,
  });

  // Settings.reportAlerts → tell the admins.
  const settings = await CatalogService.getSettings();
  if (settings.reportAlerts) {
    ReviewService.notifyAdmins({
      actor: req.user._id,
      title: "New report",
      message: `New report #${report.number}: ${reason} (${targetType})`,
      data: { reportId: String(report._id) },
    }).catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: "Thanks for letting us know. Our team will review it.",
    data: {
      report: {
        _id: report._id,
        number: report.number,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      },
    },
  });
});

export { createReport };
