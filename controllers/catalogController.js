import { CatalogService } from "#services";
import { asyncHandler } from "#utils";

/**
 * Public catalog — every admin-managed list and app setting the clients need
 * (cuisines with counts, features, tags, dietary, moods, report reasons,
 * cities, default city, app config) in one cacheable round-trip.
 * GET /api/catalog
 */
const getCatalog = asyncHandler(async (req, res) => {
  const catalog = await CatalogService.buildCatalog();
  res.json({ success: true, data: catalog });
});

export { getCatalog };
