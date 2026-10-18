import { Review, Restaurant, User, FavoriteList, ReviewLabelRequest, Taxonomy, Notification, MenuItem } from "#models";
import { SENTIMENT_SCORE, REVIEW_LIMITS, REVIEW_COOLDOWN_MS } from "#models/review.model.js";
import { ReviewService, CatalogService } from "#services";
import { asyncHandler, escapeRegex } from "#utils";
import { allValues, projectTranslations, translated } from "#utils/translations.js";
import { mongoose } from "#lib";

/**
 * Reviews (mobile). Every read needs a signed-in user — guests cannot see
 * reviews; the public rating summary stays on the restaurant payload (and
 * GET /api/reviews/summary).
 */

const { ObjectId } = mongoose.Types;
const { isObjectId, toPublic } = ReviewService;
const { cleanName, toBool } = CatalogService;

// `code`: stable error code the apps translate (Accept-Language localizes the message too).
const badRequest = (res, message, code) =>
  res.status(400).json({ success: false, message, ...(code ? { code } : {}) });
const notFound = (res, message = "Review not found", code = "REVIEW_NOT_FOUND") =>
  res.status(404).json({ success: false, message, code });

const pageParams = (query, { defaultLimit = 10, maxLimit = 50 } = {}) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};
const pagination = ({ page, limit }, total) => ({ page, limit, total, pages: Math.ceil(total / limit) });

// ?sort= for review lists.
const SORTS = {
  recent: { createdAt: -1 },
  oldest: { createdAt: 1 },
  highest: { score: -1, createdAt: -1 },
  lowest: { score: 1, createdAt: -1 },
  popular: { likeCount: -1, createdAt: -1 },
};

const DAY = 24 * 60 * 60 * 1000;

const restaurantNotFound = (res) => notFound(res, "Restaurant not found", "RESTAURANT_NOT_FOUND");
// One new review per user per restaurant per 24 h (retryAfter: seconds).
const reviewTooSoon = (res, retryAfter) => {
  res.set("Retry-After", String(retryAfter));
  return res.status(429).json({
    success: false,
    message: "You already reviewed this restaurant in the last 24 hours. You can edit that review or post a new one later.",
    code: "REVIEW_TOO_SOON",
    retryAfter,
  });
};

// Text fields must be strings (an object would be stored as "[object Object]").
const isTextOrEmpty = (value) => value === undefined || value === null || typeof value === "string";

/** Name of a menu item in every language, lower-cased (dish matching). */
const dishNames = (item) => allValues(item, "name").map((v) => v.trim().toLowerCase());

/**
 * Favourite dishes → stored shape. The app sends the dish name in the user's
 * language and, when picked from the menu, `menuItem`. A menu item of THIS
 * restaurant (by id, or by its name in any language) is stored with its
 * canonical English name and copies of its az / ru names, so every reader
 * sees it in their language; unknown names stay free text.
 * → { dishes } | { error }
 */
const resolveDishes = async (raw, restaurantId) => {
  const entries = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const name = cleanName(typeof entry === "string" ? entry : typeof entry?.name === "string" ? entry.name : "");
    const menuItem = entry && typeof entry === "object" && isObjectId(entry.menuItem) ? String(entry.menuItem) : null;
    if (!name && !menuItem) continue;
    if (name.length > 80) return { error: "Dish names must be at most 80 characters" };
    entries.push({ name, menuItem });
  }
  if (!entries.length) return { dishes: [] };

  const items = isObjectId(restaurantId)
    ? await MenuItem.find({ restaurant: restaurantId }, "name translations").lean()
    : [];
  const byId = new Map(items.map((item) => [String(item._id), item]));
  const byName = new Map();
  items.forEach((item) =>
    dishNames(item).forEach((key) => {
      if (!byName.has(key)) byName.set(key, item);
    }),
  );

  const dishes = [];
  const seen = new Set();
  for (const { name, menuItem } of entries) {
    // A menu item of another restaurant (or a deleted one) is not linked.
    const item = (menuItem && byId.get(menuItem)) || (name ? byName.get(name.toLowerCase()) : null) || null;
    if (!item && !name) continue;
    const key = item ? `id:${item._id}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dishes.push(
      item
        ? { name: item.name, menuItem: item._id, translations: projectTranslations(item, { name: "name" }) }
        : { name, menuItem: null },
    );
  }
  return { dishes };
};

/**
 * Validate the composer fields present in `body` (create: sentiment required).
 * `user` = the author (companions must be people they follow or who follow
 * them). → { fields } (only the provided keys, normalised) | { error, code? }
 */
const buildFields = async (body, { user, restaurant, existing = null, isCreate = false }) => {
  const userId = user._id;
  const fields = {};

  if (body.sentiment !== undefined || isCreate) {
    if (!(body.sentiment in SENTIMENT_SCORE)) return { error: "sentiment must be liked, fine or disliked" };
    fields.sentiment = body.sentiment;
  }

  if (body.comment !== undefined) {
    if (body.comment !== null && typeof body.comment !== "string") return { error: "comment must be text" };
    const comment = String(body.comment ?? "").trim();
    if (comment.length > REVIEW_LIMITS.comment) {
      return { error: `Review text must be at most ${REVIEW_LIMITS.comment} characters`, code: "REVIEW_TOO_LONG" };
    }
    fields.comment = comment;
  }

  if (body.photos !== undefined) {
    const { photos, error } = ReviewService.validatePhotos(body.photos || [], userId, existing?.photos);
    if (error) return { error };
    if (photos.length > REVIEW_LIMITS.photos) return { error: `At most ${REVIEW_LIMITS.photos} photos` };
    fields.photos = photos;
  }

  if (body.companions !== undefined) {
    const raw = Array.isArray(body.companions) ? body.companions : [];
    const ids = [...new Set(raw.map((c) => String(c?._id ?? c)))];
    if (ids.some((id) => !isObjectId(id))) return { error: "companions must be user ids" };
    const others = ids.filter((id) => id !== String(userId));
    if (others.length > REVIEW_LIMITS.companions) {
      return { error: `At most ${REVIEW_LIMITS.companions} tagged friends` };
    }
    // Only people I follow or who follow me (or already tagged); unknown /
    // inactive / unrelated users are silently dropped.
    const users = others.length
      ? await User.find(
          {
            _id: { $in: others },
            isDeleted: false,
            status: "active",
            $or: [
              { _id: { $in: user.following || [] } },
              { following: userId },
              { _id: { $in: existing?.companions || [] } },
            ],
          },
          "_id",
        ).lean()
      : [];
    const valid = new Set(users.map((u) => String(u._id)));
    fields.companions = others.filter((id) => valid.has(id));
  }

  if (body.labels !== undefined) {
    const { names, unknown } = await CatalogService.resolveNames("reviewLabel", body.labels || [], {
      keep: existing?.labels || [],
    });
    if (unknown.length) return { error: `Unknown labels: ${unknown.join(", ")}` };
    if (names.length > REVIEW_LIMITS.labels) return { error: `At most ${REVIEW_LIMITS.labels} labels` };
    fields.labels = names;
  }

  if (body.favoriteDishes !== undefined) {
    const { dishes, error } = await resolveDishes(body.favoriteDishes, String(restaurant ?? existing?.restaurant ?? ""));
    if (error) return { error };
    if (dishes.length > REVIEW_LIMITS.favoriteDishes) {
      return { error: `At most ${REVIEW_LIMITS.favoriteDishes} favourite dishes` };
    }
    fields.favoriteDishes = dishes;
  }

  if (body.visitDate !== undefined) {
    if (body.visitDate === null || body.visitDate === "") {
      fields.visitDate = null;
    } else {
      const date = new Date(body.visitDate);
      if (Number.isNaN(date.getTime())) return { error: "visitDate must be a date" };
      if (date.getTime() > Date.now() + DAY) return { error: "visitDate cannot be in the future" };
      if (date.getFullYear() < 2000) return { error: "visitDate is too far in the past" };
      fields.visitDate = date;
    }
  } else if (isCreate) {
    fields.visitDate = new Date(); // Figma default "Today"
  }

  if (body.isStealth !== undefined) fields.isStealth = toBool(body.isStealth);

  return { fields };
};

// Content fields whose change sends a review back through moderation.
const MODERATED_FIELDS = ["sentiment", "comment", "photos", "labels", "favoriteDishes"];
// Dishes compare by name + menu item (stored translations are derived).
const comparable = (key, value) =>
  key === "favoriteDishes" && Array.isArray(value)
    ? value.map((d) => [d.name, d.menuItem ? String(d.menuItem) : null])
    : value;
const sameValue = (key, a, b) =>
  JSON.stringify(comparable(key, a) ?? null) === JSON.stringify(comparable(key, b) ?? null);

// Statuses an author's edit may re-run moderation on. A rejected / flagged
// review stays so until an admin looks at it again (editedAt shows the edit).
const REMODERATED_STATUSES = ["pending", "approved"];

/**
 * Apply validated fields to an existing review, re-moderate on content
 * change (pending / approved reviews only), clean up removed photos and
 * refresh the restaurant rating.
 */
const applyUpdate = async (review, fields) => {
  const before = review.toObject();
  const changed = MODERATED_FIELDS.some(
    (key) => fields[key] !== undefined && !sameValue(key, fields[key], before[key]),
  );
  Object.entries(fields).forEach(([key, value]) => {
    review[key] = value;
  });
  if (changed) {
    review.editedAt = new Date();
    if (REMODERATED_STATUSES.includes(review.status || "approved")) {
      const { status, note } = await ReviewService.moderationFor(review.sentiment);
      review.status = status;
      review.moderationNote = note;
      review.moderatedBy = null;
      review.moderatedAt = null;
    }
  }
  await review.save();

  if (fields.photos !== undefined) {
    const keep = new Set(review.photos);
    await ReviewService.deletePhotos((before.photos || []).filter((p) => !keep.has(p)), review._id);
  }
  await ReviewService.recomputeRestaurant(review.restaurant);
  // Newly public after the edit → followers' list-visit notice (deduped).
  if (review.status === "approved" && before.status !== "approved" && !review.isStealth) {
    await Notification.notifyListVisit({ actor: review.user, restaurant: review.restaurant, review: review._id });
  }
  return review;
};

// Tagged friends learn they were tagged — once per review, only while it is public.
const notifyCompanions = (review) => {
  ReviewService.notifyCompanions(review);
};

const populateReview = (query) =>
  query
    .populate("user", `${ReviewService.AUTHOR_FIELDS}`)
    .populate({ path: "companions", select: ReviewService.USER_CARD_FIELDS, match: { isDeleted: false } });

// Most of the viewer's own reviews of one place returned with a review list.
const MY_REVIEWS_LIMIT = 50;

/**
 * List a restaurant's public reviews (approved only), newest first.
 * GET /api/reviews?restaurant=:id&page=1&limit=10&sort=recent|oldest|highest|lowest|popular&sentiment=
 * → { reviews, myReviews, myReview, summary, distribution, pagination }
 *   myReviews — the viewer's own reviews of this place (any status), newest
 *   first; myReview = the latest of them (null without one), kept for older clients.
 */
const listReviews = asyncHandler(async (req, res) => {
  const { restaurant } = req.query;
  if (!isObjectId(restaurant)) return badRequest(res, "A valid restaurant id is required");
  const params = pageParams(req.query);
  const sort = SORTS[req.query.sort] || SORTS.recent;

  const extra = { restaurant };
  if (req.query.sentiment) {
    if (!(req.query.sentiment in SENTIMENT_SCORE)) return badRequest(res, "Invalid sentiment");
    extra.sentiment = req.query.sentiment;
  }
  // Reviews of a hidden restaurant (pending, suspended, Trash) are not public.
  if (!(await ReviewService.isRestaurantPublic(restaurant))) return restaurantNotFound(res);
  const hidden = await ReviewService.hiddenAuthorIds();
  const filter = await ReviewService.publicFilter(extra, { hidden });

  const [reviews, total, summary, mine] = await Promise.all([
    populateReview(Review.find(filter).sort(sort).skip(params.skip).limit(params.limit)),
    Review.countDocuments(filter),
    ReviewService.summarize(restaurant, { hidden }),
    populateReview(
      Review.find({ restaurant, user: req.user._id, isDeleted: false }).sort({ createdAt: -1 }).limit(MY_REVIEWS_LIMIT),
    ),
  ]);
  const myReviews = mine.map((r) => toPublic(r, req.user));

  res.json({
    success: true,
    data: {
      reviews: reviews.map((r) => toPublic(r, req.user)),
      myReviews,
      myReview: myReviews[0] || null, // kept for older clients
      summary,
      distribution: summary.distribution, // kept for older clients
      pagination: pagination(params, total),
    },
  });
});

/**
 * Public rating summary (same aggregation as the review list header).
 * GET /api/reviews/summary?restaurant=:id
 * → { summary: { rating, reviewCount, likedPercent, distribution, reviewStats } }
 */
const getSummary = asyncHandler(async (req, res) => {
  const { restaurant } = req.query;
  if (!isObjectId(restaurant)) return badRequest(res, "A valid restaurant id is required");
  if (!(await ReviewService.isRestaurantPublic(restaurant))) return restaurantNotFound(res);
  const summary = await ReviewService.summarize(restaurant);
  res.json({ success: true, data: { summary } });
});

/**
 * "Photos from members": photos of a restaurant's public reviews, newest
 * first; `dish` keeps photos of reviews that list that favourite dish — a
 * menu item id, or its name in any language (`menuItem` = id also works).
 * GET /api/reviews/photos?restaurant=:id&dish=&menuItem=&page=1&limit=20
 * → { photos: [{ url, review, dish, user, createdAt }], pagination }
 */
const listPhotos = asyncHandler(async (req, res) => {
  const { restaurant } = req.query;
  if (!isObjectId(restaurant)) return badRequest(res, "A valid restaurant id is required");
  if (!(await ReviewService.isRestaurantPublic(restaurant))) return restaurantNotFound(res);
  const params = pageParams(req.query, { defaultLimit: 20 });
  const dish = cleanName(typeof req.query.dish === "string" ? req.query.dish : "");
  const menuItemId = isObjectId(req.query.menuItem) ? String(req.query.menuItem) : isObjectId(dish) ? dish : null;

  const match = await ReviewService.publicFilter({ restaurant: new ObjectId(restaurant) });
  match["photos.0"] = { $exists: true };
  // Menu items the filter means (by id, or by name in en / az / ru).
  const dishIds = new Set(menuItemId ? [menuItemId] : []);
  const dishName = menuItemId ? "" : dish.toLowerCase();
  if (dishName) {
    const items = await MenuItem.find({ restaurant }, "name translations").lean();
    items.filter((item) => dishNames(item).includes(dishName)).forEach((item) => dishIds.add(String(item._id)));
  }
  if (dishIds.size || dishName) {
    const rx = dishName ? { $regex: `^${escapeRegex(dish)}$`, $options: "i" } : null;
    match.$or = [
      ...(dishIds.size ? [{ "favoriteDishes.menuItem": { $in: [...dishIds].map((id) => new ObjectId(id)) } }] : []),
      ...(rx
        ? [{ "favoriteDishes.name": rx }, { "favoriteDishes.translations.az.name": rx }, { "favoriteDishes.translations.ru.name": rx }]
        : []),
    ];
  }
  const matchesDish = (d) =>
    (d.menuItem && dishIds.has(String(d.menuItem))) ||
    (!!dishName && [d.name, d.translations?.az?.name, d.translations?.ru?.name].some((v) => v?.toLowerCase() === dishName));

  const [rows, totals] = await Promise.all([
    Review.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $unwind: "$photos" },
      { $skip: params.skip },
      { $limit: params.limit },
      { $project: { photos: 1, user: 1, isStealth: 1, createdAt: 1, favoriteDishes: 1 } },
    ]),
    Review.aggregate([{ $match: match }, { $project: { n: { $size: "$photos" } } }, { $group: { _id: null, total: { $sum: "$n" } } }]),
  ]);
  const authors = await User.find(
    { _id: { $in: rows.filter((r) => !r.isStealth).map((r) => r.user) } },
    `${ReviewService.USER_CARD_FIELDS} isPrivate settings.reviewsVisibility`,
  ).lean();
  const byId = new Map(authors.map((u) => [String(u._id), u]));

  res.json({
    success: true,
    data: {
      photos: rows.map((r) => {
        const author = r.isStealth ? null : byId.get(String(r.user));
        const visible = author && ReviewService.canSeeActivity(req.user, author);
        const found = dishIds.size || dishName ? (r.favoriteDishes || []).find(matchesDish) : null;
        return {
          url: r.photos,
          review: r._id,
          dish: found ? translated(found, "name", req.lang) : dish || null,
          user: visible ? ReviewService.publicUser(author) : null,
          createdAt: r.createdAt,
        };
      }),
      pagination: pagination(params, totals[0]?.total || 0),
    },
  });
});

/**
 * Write a NEW review of a restaurant — a user may review the same place
 * several times (separate visits); edits go through PUT /api/reviews/:id.
 * At most one new review per user per restaurant per 24 h → 429
 * REVIEW_TOO_SOON { retryAfter: seconds } (+ Retry-After header). New content
 * goes through moderation (Settings.autoApproveReviews / autoFlagReviews).
 * POST /api/reviews
 *   { restaurant, sentiment, comment?, photos?, companions?, labels?,
 *     favoriteDishes?, visitDate?, isStealth? }
 * → 201 { review }
 */
const createReview = asyncHandler(async (req, res) => {
  const { restaurant } = req.body;
  if (!isObjectId(restaurant)) return badRequest(res, "restaurant and sentiment are required");

  // Only public (active) restaurants can be reviewed.
  if (!(await ReviewService.isRestaurantPublic(restaurant))) return restaurantNotFound(res);

  const retryAfter = await ReviewService.newReviewCooldown({ restaurant, user: req.user._id });
  if (retryAfter > 0) return reviewTooSoon(res, retryAfter);

  const { fields, error, code } = await buildFields(req.body, { user: req.user, restaurant, isCreate: true });
  if (error) return badRequest(res, error, code);

  // Held as pending after an earlier removed / rejected / flagged review of this place.
  const { status, note } = await ReviewService.moderationForNew({
    restaurant,
    user: req.user._id,
    sentiment: fields.sentiment,
  });
  let review = await Review.create({
    restaurant,
    user: req.user._id,
    ...fields,
    status,
    moderationNote: note,
  });
  // Two parallel posts both passed the check above: only the first one stays.
  const first = await Review.findOne(
    { restaurant, user: req.user._id, createdAt: { $gt: new Date(review.createdAt.getTime() - REVIEW_COOLDOWN_MS) } },
    "_id",
  )
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  if (first && String(first._id) !== String(review._id)) {
    await Review.deleteOne({ _id: review._id });
    return reviewTooSoon(res, Math.ceil(REVIEW_COOLDOWN_MS / 1000));
  }
  await ReviewService.recomputeRestaurant(restaurant);
  notifyCompanions(review);
  if (review.status === "approved" && !review.isStealth) {
    await Notification.notifyListVisit({ actor: req.user._id, restaurant, review: review._id });
  }

  review = await populateReview(Review.findById(review._id));
  res.status(201).json({
    success: true,
    message: review.status === "approved" ? "Review saved" : "Review submitted for moderation",
    data: { review: toPublic(review, req.user) },
  });
});

/**
 * Edit the current user's review (any subset of the composer fields).
 * PUT /api/reviews/:id → { review }
 */
const updateReview = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const review = await Review.findOne({ _id: req.params.id, isDeleted: false });
  if (!review) return notFound(res);
  if (String(review.user) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "You can only edit your own review", code: "FORBIDDEN" });
  }

  const { fields, error, code } = await buildFields(req.body, { user: req.user, existing: review });
  if (error) return badRequest(res, error, code);

  await applyUpdate(review, fields);
  notifyCompanions(review);

  const fresh = await populateReview(Review.findById(review._id));
  res.json({
    success: true,
    message: fresh.status === "approved" ? "Review saved" : "Review submitted for moderation",
    data: { review: toPublic(fresh, req.user) },
  });
});

/**
 * The current user's reviews, any status (Profile → My reviews).
 * GET /api/reviews/mine?page=1&limit=20 → { reviews, pagination }
 */
const myReviews = asyncHandler(async (req, res) => {
  const params = pageParams(req.query, { defaultLimit: 20 });
  // Reviews of restaurants that are no longer public (Trash, suspended…) are
  // left out — their profile would open as a 404.
  const hiddenRestaurants = await Restaurant.distinct("_id", {
    $or: [{ isDeleted: true }, { status: { $ne: "active" } }],
  });
  const filter = { user: req.user._id, isDeleted: false, restaurant: { $nin: hiddenRestaurants } };
  const [reviews, total] = await Promise.all([
    populateReview(
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(params.skip)
        .limit(params.limit)
        .populate({ path: "restaurant", select: ReviewService.RESTAURANT_FIELDS, match: { isDeleted: false } }),
    ),
    Review.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: {
      reviews: reviews.map((r) => toPublic(r, req.user)),
      pagination: pagination(params, total),
    },
  });
});

/**
 * Single review + restaurant (Comment page). Counts a view for non-authors.
 * GET /api/reviews/:id → { review }
 */
const getReview = asyncHandler(async (req, res) => {
  const review = await ReviewService.findVisible(req.params.id, req.user);
  if (!review) return notFound(res);
  if (String(review.user?._id ?? review.user) !== String(req.user._id)) {
    await Review.updateOne({ _id: review._id }, { $inc: { viewCount: 1 } }, { timestamps: false });
    review.viewCount = (review.viewCount || 0) + 1;
  }
  res.json({ success: true, data: { review: toPublic(review, req.user) } });
});

/**
 * Count a view (feed impression / reactions sheet opened).
 * POST /api/reviews/:id/view → { viewCount }
 */
const addView = asyncHandler(async (req, res) => {
  const review = await ReviewService.findVisible(req.params.id, req.user, { populate: false });
  if (!review) return notFound(res);
  let { viewCount } = review;
  if (String(review.user) !== String(req.user._id)) {
    const updated = await Review.findOneAndUpdate(
      { _id: review._id },
      { $inc: { viewCount: 1 } },
      { returnDocument: "after", timestamps: false, projection: { viewCount: 1 } },
    );
    viewCount = updated?.viewCount ?? viewCount + 1;
  }
  res.json({ success: true, data: { viewCount } });
});

/**
 * Like / unlike a review (atomic). Body { liked: true|false } sets the state,
 * no body toggles.
 * POST /api/reviews/:id/like → { liked, likeCount }
 */
const toggleLike = asyncHandler(async (req, res) => {
  const review = await ReviewService.findVisible(req.params.id, req.user, { populate: false });
  if (!review) return notFound(res);

  const uid = req.user._id;
  const alreadyLiked = review.likes.some((l) => String(l) === String(uid));
  const wantLiked = req.body?.liked === undefined ? !alreadyLiked : toBool(req.body.liked);

  let result = null;
  if (wantLiked) {
    result = await Review.findOneAndUpdate(
      { _id: review._id, likes: { $ne: uid } },
      { $push: { likes: uid }, $inc: { likeCount: 1 } },
      { returnDocument: "after", timestamps: false, projection: { likeCount: 1 } },
    );
    if (result) {
      // review_like is de-duplicated by the Notification model.
      ReviewService.notify({
        recipient: review.user,
        actor: uid,
        type: "review_like",
        fallbackType: "review",
        message: "liked your review.",
        review: review._id,
        restaurant: review.restaurant,
      });
    }
  } else {
    result = await Review.findOneAndUpdate(
      { _id: review._id, likes: uid },
      { $pull: { likes: uid }, $inc: { likeCount: -1 } },
      { returnDocument: "after", timestamps: false, projection: { likeCount: 1 } },
    );
    // Unliked → the "liked your review" notice goes away.
    if (result) Notification.retract({ type: "review_like", actor: uid, review: review._id }).catch(() => {});
  }
  const likeCount = result
    ? Math.max(0, result.likeCount)
    : (await Review.findById(review._id, "likeCount").lean())?.likeCount || 0;

  res.json({ success: true, data: { liked: wantLiked, likeCount } });
});

/**
 * "Liked by" list for the Reactions sheet, with follow state.
 * GET /api/reviews/:id/likes?page=1&limit=20&search=
 * → { users: [{ _id, firstName, lastName, avatar, verified, isFollowing, isMe }], likeCount, viewCount, pagination }
 */
const listLikes = asyncHandler(async (req, res) => {
  const review = await ReviewService.findVisible(req.params.id, req.user, { populate: false });
  if (!review) return notFound(res);
  const params = pageParams(req.query, { defaultLimit: 20 });

  const filter = { _id: { $in: review.likes }, isDeleted: false, status: "active" };
  const search = cleanName(req.query.search);
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    filter.$or = [{ firstName: rx }, { lastName: rx }];
  }
  const [users, total] = await Promise.all([
    User.find(filter, ReviewService.USER_CARD_FIELDS)
      .sort({ firstName: 1, lastName: 1 })
      .skip(params.skip)
      .limit(params.limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  const following = new Set((req.user.following || []).map(String));

  res.json({
    success: true,
    data: {
      users: users.map((u) => ({
        ...ReviewService.publicUser(u),
        isFollowing: following.has(String(u._id)),
        isMe: String(u._id) === String(req.user._id),
      })),
      likeCount: review.likeCount || 0,
      viewCount: review.viewCount || 0,
      pagination: pagination(params, total),
    },
  });
});

const SHARE_CHANNELS = ["link", "whatsapp", "sms", "instagram", "other"];

/**
 * Count an external share of a review (Copy link, WhatsApp, SMS, ...). In-app
 * sending to other Yumio users was removed: a non-empty `recipients` answers
 * 400 SHARE_DISABLED (notifications sent earlier — type "share" — still render).
 * POST /api/reviews/:id/share { channel } → { sent: 0, shareCount }
 */
const shareReview = asyncHandler(async (req, res) => {
  const review = await ReviewService.findVisible(req.params.id, req.user, { populate: false });
  if (!review) return notFound(res);

  const recipients = req.body?.recipients;
  if (recipients !== undefined && recipients !== null && !(Array.isArray(recipients) && !recipients.length)) {
    return badRequest(res, "Sending reviews to other users in the app is no longer available. Share the link instead", "SHARE_DISABLED");
  }
  const channel = req.body?.channel;
  if (channel === undefined) return badRequest(res, `channel is required (${SHARE_CHANNELS.join(", ")})`);
  if (!SHARE_CHANNELS.includes(channel)) {
    return badRequest(res, `channel must be one of: ${SHARE_CHANNELS.join(", ")}`);
  }
  // Older apps may still send a note with an external share; it is not stored.
  if (!isTextOrEmpty(req.body?.message)) return badRequest(res, "message must be text");

  const updated = await Review.findOneAndUpdate(
    { _id: review._id },
    { $inc: { shareCount: 1 } },
    { returnDocument: "after", timestamps: false, projection: { shareCount: 1 } },
  );
  res.json({
    success: true,
    message: "Shared",
    data: { sent: 0, shareCount: updated?.shareCount ?? 0 },
  });
});

/**
 * People to tag in "Who did you go with?" — users I follow and my followers,
 * with the number of restaurants we both reviewed or saved.
 * GET /api/reviews/companions?search=&page=1&limit=20
 * → { users: [{ _id, firstName, lastName, avatar, verified, isFollowing, mutualRestaurants }], pagination }
 */
const companionCandidates = asyncHandler(async (req, res) => {
  const params = pageParams(req.query, { defaultLimit: 20 });
  const me = req.user._id;
  const filter = {
    _id: { $ne: me },
    isDeleted: false,
    status: "active",
    $or: [{ _id: { $in: req.user.following || [] } }, { following: me }],
  };
  const search = cleanName(req.query.search);
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    filter.$and = [{ $or: [{ firstName: rx }, { lastName: rx }] }];
  }

  const [users, total] = await Promise.all([
    User.find(filter, ReviewService.USER_CARD_FIELDS)
      .sort({ firstName: 1, lastName: 1 })
      .skip(params.skip)
      .limit(params.limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  // Restaurants each person reviewed or saved, intersected with mine.
  const restaurantsOf = async (userIds) => {
    const [reviews, lists] = await Promise.all([
      Review.aggregate([
        { $match: { user: { $in: userIds }, isDeleted: false } },
        { $group: { _id: "$user", restaurants: { $addToSet: "$restaurant" } } },
      ]),
      FavoriteList.aggregate([
        { $match: { owner: { $in: userIds }, isDeleted: false } },
        { $unwind: "$items" },
        { $group: { _id: "$owner", restaurants: { $addToSet: "$items.restaurant" } } },
      ]),
    ]);
    const map = new Map();
    [...reviews, ...lists].forEach((row) => {
      const key = String(row._id);
      const set = map.get(key) || new Set();
      row.restaurants.forEach((r) => set.add(String(r)));
      map.set(key, set);
    });
    return map;
  };
  const sets = users.length ? await restaurantsOf([me, ...users.map((u) => u._id)]) : new Map();
  const mine = sets.get(String(me)) || new Set();
  const following = new Set((req.user.following || []).map(String));

  res.json({
    success: true,
    data: {
      users: users.map((u) => {
        const theirs = sets.get(String(u._id)) || new Set();
        let mutual = 0;
        theirs.forEach((r) => {
          if (mine.has(r)) mutual += 1;
        });
        return {
          ...ReviewService.publicUser(u),
          isFollowing: following.has(String(u._id)),
          mutualRestaurants: mutual,
        };
      }),
      pagination: pagination(params, total),
    },
  });
});

const MAX_PENDING_LABEL_REQUESTS = 10;

/**
 * "Request a label" — suggest a new review label for admins to approve.
 * POST /api/reviews/label-requests { label, group? } → 201 { request }
 */
const requestLabel = asyncHandler(async (req, res) => {
  if (typeof req.body?.label !== "string") return badRequest(res, "Label idea is required");
  if (!isTextOrEmpty(req.body?.group)) return badRequest(res, "Group must be text");
  const label = cleanName(req.body?.label);
  const group = cleanName(req.body?.group);
  if (label.length < 2) return badRequest(res, "Label idea is required");
  if (label.length > 60) return badRequest(res, "Label idea must be at most 60 characters");
  if (group.length > 40) return badRequest(res, "Group must be at most 40 characters");

  const rx = { $regex: `^${escapeRegex(label)}$`, $options: "i" };
  if (await Taxonomy.exists({ type: "reviewLabel", name: rx, isActive: true })) {
    return res.status(409).json({ success: false, message: "This label already exists", code: "LABEL_EXISTS" });
  }
  const pending = await ReviewLabelRequest.find({ user: req.user._id, status: "pending" }, "label").lean();
  if (pending.some((p) => p.label.toLowerCase() === label.toLowerCase())) {
    return res.status(409).json({ success: false, message: "You already suggested this label", code: "LABEL_ALREADY_SUGGESTED" });
  }
  if (pending.length >= MAX_PENDING_LABEL_REQUESTS) {
    return res.status(429).json({
      success: false,
      message: "Please wait until your earlier ideas are reviewed",
      code: "LABEL_REQUESTS_PENDING",
    });
  }

  const request = await ReviewLabelRequest.create({ user: req.user._id, label, group });
  res.status(201).json({
    success: true,
    message: "Thanks! We'll review your label idea.",
    data: {
      request: {
        _id: request._id,
        label: request.label,
        group: request.group,
        status: request.status,
        createdAt: request.createdAt,
      },
    },
  });
});

/**
 * Delete the current user's review (admins use DELETE /api/admin/reviews/:id).
 * The user can write a new review of the restaurant afterwards.
 * DELETE /api/reviews/:id
 */
const deleteReview = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const review = await Review.findOne({ _id: req.params.id, isDeleted: false });
  if (!review) return notFound(res);
  const isAdmin = req.user.role === "admin";
  if (String(review.user) !== String(req.user._id) && !isAdmin) {
    return res.status(403).json({ success: false, message: "Not allowed", code: "FORBIDDEN" });
  }
  const byAdmin = isAdmin && String(review.user) !== String(req.user._id);
  await ReviewService.removeReview(review, { by: req.user._id, byAdmin });
  res.json({ success: true, message: "Review deleted", data: { review: { _id: review._id } } });
});

export {
  listReviews,
  getSummary,
  listPhotos,
  createReview,
  updateReview,
  myReviews,
  getReview,
  addView,
  toggleLike,
  listLikes,
  shareReview,
  companionCandidates,
  requestLabel,
  deleteReview,
};
