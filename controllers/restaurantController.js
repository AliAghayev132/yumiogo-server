// Lib
import { mongoose } from "#lib";

// Models
import { Restaurant } from "#models";

// Constants
import { cuisineTypes } from "#constants";

// Services
import { FileService } from "#services";

// Utils
import { asyncHandler } from "#utils";

// Collect every locally-uploaded image path referenced by a restaurant doc.
const localImagesOf = (r) =>
  [...(r.coverImages || []), r.logo, ...(r.popularDishes || []).map((d) => d.image)]
    .filter((p) => p && !String(p).startsWith("http"));

/**
 * Build a Mongo filter + sort from query params shared by list/search.
 * Supported query: search, cuisine, priceLevel, openNow, discount, sort.
 */
const buildQuery = (query) => {
  const filter = { status: "active", isDeleted: false };

  if (query.cuisine) filter.cuisines = query.cuisine;
  if (query.priceLevel) filter.priceLevel = query.priceLevel;
  if (query.openNow === "true") filter.openNow = true;
  if (query.discount === "true") filter.discountPercent = { $gt: 0 };
  if (query.minRating) filter.rating = { $gte: Number(query.minRating) };
  if (query.minReviews) filter.reviewCount = { $gte: Number(query.minReviews) };
  if (query.minPrice || query.maxPrice) {
    filter.avgPrice = {};
    if (query.minPrice) filter.avgPrice.$gte = Number(query.minPrice);
    if (query.maxPrice) filter.avgPrice.$lte = Number(query.maxPrice);
  }
  if (query.search || query.q) {
    filter.name = { $regex: String(query.search || query.q), $options: "i" };
  }

  let sort = { rating: -1 };
  switch (query.sort) {
    case "popularity":
      sort = { viewCount: -1 };
      break;
    case "saved":
      sort = { saveCount: -1 };
      break;
    case "newest":
      sort = { createdAt: -1 };
      break;
    case "rating":
    default:
      sort = { rating: -1, reviewCount: -1 };
  }

  return { filter, sort };
};

/**
 * List restaurants (public) with pagination, filters and sorting.
 * GET /api/restaurants?page=1&limit=10&cuisine=Turkish&sort=rating&search=cafe
 * Supports geo "near you": &near=<lng>,<lat>&radius=<meters>
 */
const listRestaurants = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const skip = (page - 1) * limit;

  const { filter, sort } = buildQuery(req.query);

  // Geospatial "near you" — cannot use skip well with $near, so keep it simple.
  if (req.query.near) {
    const [lng, lat] = String(req.query.near).split(",").map(Number);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
      const radius = Math.min(parseInt(req.query.radius, 10) || 15000, 50000);
      filter.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: radius,
        },
      };
    }
  }

  const [restaurants, total] = await Promise.all([
    Restaurant.find(filter).sort(sort).skip(skip).limit(limit),
    Restaurant.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      restaurants,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

/**
 * Aggregated Home feed — returns every section the Home screen needs
 * in a single round-trip.
 * GET /api/restaurants/home?near=<lng>,<lat>
 */
const getHomeFeed = asyncHandler(async (req, res) => {
  const base = { status: "active", isDeleted: false };

  let nearFilter = { ...base };
  if (req.query.near) {
    const [lng, lat] = String(req.query.near).split(",").map(Number);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
      nearFilter.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: 20000,
        },
      };
    }
  }

  const [nearYou, discounted, topViewed, topSaved] = await Promise.all([
    Restaurant.find(nearFilter).limit(10),
    Restaurant.find({ ...base, discountPercent: { $gt: 0 } })
      .sort({ discountPercent: -1 })
      .limit(10),
    Restaurant.find(base).sort({ viewCount: -1 }).limit(5),
    Restaurant.find(base).sort({ saveCount: -1 }).limit(5),
  ]);

  res.json({
    success: true,
    data: {
      cuisines: cuisineTypes,
      nearYou,
      discounted,
      topViewed,
      topSaved,
    },
  });
});

/**
 * Distinct cuisines with restaurant counts (Home "Cuisines" row).
 * GET /api/restaurants/cuisines
 */
const getCuisines = asyncHandler(async (req, res) => {
  const counts = await Restaurant.aggregate([
    { $match: { status: "active", isDeleted: false } },
    { $unwind: "$cuisines" },
    { $group: { _id: "$cuisines", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const map = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  const cuisines = cuisineTypes.map((name) => ({ name, count: map[name] || 0 }));

  res.json({ success: true, data: { cuisines } });
});

/**
 * Search restaurants with filters + sorting, returning distance when a location
 * is supplied. Powers the Search results (list + map).
 * GET /api/restaurants/search?q=&near=<lng>,<lat>&sort=&minRating=&maxPrice=&cuisine=&radius=
 */
const searchRestaurants = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const skip = (page - 1) * limit;

  const { filter, sort } = buildQuery(req.query);

  // Parse an optional [lng, lat] location.
  let coords = null;
  if (req.query.near) {
    const [lng, lat] = String(req.query.near).split(",").map(Number);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) coords = [lng, lat];
  }

  // With a location we use $geoNear (first stage) to attach a distance to each
  // result; the other filters/sort are applied afterwards in the pipeline.
  if (coords) {
    const radius = Math.min(parseInt(req.query.radius, 10) || 20000, 50000);
    // When sorting by distance, let $geoNear order; otherwise sort after.
    const sortByDistance = !req.query.sort || req.query.sort === "distance";

    const pipeline = [
      {
        $geoNear: {
          near: { type: "Point", coordinates: coords },
          distanceField: "distanceMeters",
          maxDistance: radius,
          spherical: true,
          query: filter,
        },
      },
    ];
    if (!sortByDistance) pipeline.push({ $sort: sort });
    const countPipeline = [...pipeline, { $count: "total" }];
    pipeline.push({ $skip: skip }, { $limit: limit });

    const [restaurants, countRes] = await Promise.all([
      Restaurant.aggregate(pipeline),
      Restaurant.aggregate(countPipeline),
    ]);
    const total = countRes[0]?.total || 0;

    return res.json({
      success: true,
      data: {
        restaurants,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  }

  // No location → plain filtered find.
  const [restaurants, total] = await Promise.all([
    Restaurant.find(filter).sort(sort).skip(skip).limit(limit),
    Restaurant.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      restaurants,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
});

/**
 * Lightweight autocomplete for the search bar — restaurant names + cuisines.
 * GET /api/restaurants/suggest?q=caf
 */
const suggestRestaurants = asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 1) {
    return res.json({ success: true, data: { suggestions: [] } });
  }

  const rx = { $regex: q, $options: "i" };
  const matches = await Restaurant.find(
    { status: "active", isDeleted: false, name: rx },
    "name cuisines coverImages rating reviewCount",
  ).limit(6);

  const restaurantSuggestions = matches.map((r) => ({
    type: "restaurant",
    id: r._id,
    label: r.name,
    subtitle: r.cuisines?.[0] || "Restaurant",
    image: r.coverImages?.[0] || null,
  }));

  // Matching cuisines from the enum.
  const cuisineSuggestions = cuisineTypes
    .filter((c) => c.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 4)
    .map((c) => ({ type: "cuisine", label: c, subtitle: "Cuisine" }));

  res.json({
    success: true,
    data: { suggestions: [...restaurantSuggestions, ...cuisineSuggestions] },
  });
});

/**
 * Surprise me — one random open restaurant near the user, excluding already-shown ids.
 * GET /api/restaurants/surprise?near=<lng>,<lat>&exclude=id1,id2&radius=
 */
const surpriseRestaurant = asyncHandler(async (req, res) => {
  const filter = { status: "active", isDeleted: false, openNow: true };

  // Aggregation pipelines don't auto-cast strings to ObjectIds — cast explicitly.
  const exclude = String(req.query.exclude || "")
    .split(",")
    .filter((id) => id.match(/^[0-9a-fA-F]{24}$/))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (exclude.length) filter._id = { $nin: exclude };

  if (req.query.near) {
    const [lng, lat] = String(req.query.near).split(",").map(Number);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
      const radius = Math.min(parseInt(req.query.radius, 10) || 20000, 50000);
      filter.location = {
        $geoWithin: {
          $centerSphere: [[lng, lat], radius / 6378137], // meters → radians
        },
      };
    }
  }

  const [pick] = await Restaurant.aggregate([{ $match: filter }, { $sample: { size: 1 } }]);

  if (!pick) {
    return res.json({ success: true, data: { restaurant: null } });
  }
  res.json({ success: true, data: { restaurant: pick } });
});

/**
 * Get a single restaurant by id or slug; increments its view counter.
 * GET /api/restaurants/:id
 */
const getRestaurant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const byId = id.match(/^[0-9a-fA-F]{24}$/);

  const restaurant = await Restaurant.findOne({
    ...(byId ? { _id: id } : { slug: id }),
    isDeleted: false,
  });

  if (!restaurant) {
    return res
      .status(404)
      .json({ success: false, message: "Restaurant not found" });
  }

  await restaurant.incrementViews();

  res.json({ success: true, data: { restaurant } });
});

// Fields an admin may set when creating/editing a restaurant.
const EDITABLE_FIELDS = [
  "name",
  "description",
  "cuisines",
  "priceLevel",
  "avgPrice",
  "tags",
  "features",
  "address",
  "city",
  "location",
  "coverImages",
  "logo",
  "popularDishes",
  "hours",
  "openNow",
  "phone",
  "discountPercent",
  "status",
];

/**
 * Create a restaurant (admin only).
 * POST /api/restaurants
 */
const createRestaurant = asyncHandler(async (req, res) => {
  if (!req.body.name || !req.body.name.trim()) {
    return res.status(400).json({ success: false, message: "Name is required" });
  }

  const doc = { createdBy: req.user._id };
  EDITABLE_FIELDS.forEach((key) => {
    if (req.body[key] !== undefined) doc[key] = req.body[key];
  });

  const restaurant = await Restaurant.create(doc);

  res
    .status(201)
    .json({ success: true, message: "Restaurant created", data: { restaurant } });
});

/**
 * Update a restaurant (admin only).
 * PUT /api/restaurants/:id
 */
const updateRestaurant = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findOne({
    _id: req.params.id,
    isDeleted: false,
  });

  if (!restaurant) {
    return res
      .status(404)
      .json({ success: false, message: "Restaurant not found" });
  }

  const imagesBefore = localImagesOf(restaurant);

  EDITABLE_FIELDS.forEach((key) => {
    if (req.body[key] !== undefined) restaurant[key] = req.body[key];
  });

  await restaurant.save();

  // Remove locally-uploaded images that are no longer referenced.
  const imagesAfter = new Set(localImagesOf(restaurant));
  imagesBefore.filter((p) => !imagesAfter.has(p)).forEach((p) => FileService.deleteFile(p));

  res.json({ success: true, message: "Restaurant updated", data: { restaurant } });
});

/**
 * Soft-delete a restaurant (admin only).
 * DELETE /api/restaurants/:id
 */
const deleteRestaurant = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findOne({
    _id: req.params.id,
    isDeleted: false,
  });

  if (!restaurant) {
    return res
      .status(404)
      .json({ success: false, message: "Restaurant not found" });
  }

  restaurant.isDeleted = true;
  await restaurant.save();

  res.json({ success: true, message: "Restaurant deleted" });
});

export {
  listRestaurants,
  searchRestaurants,
  suggestRestaurants,
  surpriseRestaurant,
  getHomeFeed,
  getCuisines,
  getRestaurant,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
};
