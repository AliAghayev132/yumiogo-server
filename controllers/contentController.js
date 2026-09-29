import { Faq, ContentPage, OnboardingSlide, Restaurant, Review, Taxonomy } from "#models";
import { faqAudiences } from "#constants";
import { CatalogService } from "#services";
import { asyncHandler } from "#utils";

/**
 * Public app content managed in the admin panel: FAQs, legal pages,
 * onboarding slides and headline stats for the landing page.
 */

/**
 * Active FAQs, optionally for one client ("both" entries always included).
 * GET /api/content/faqs?audience=app|web
 */
const listFaqs = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const { audience } = req.query;
  if (audience && audience !== "both" && faqAudiences.includes(audience)) {
    filter.audience = { $in: [audience, "both"] };
  }

  const faqs = await Faq.find(filter, "question answer category order")
    .sort({ order: 1, createdAt: 1 })
    .lean();
  res.json({ success: true, data: { faqs } });
});

/**
 * Published pages (for link lists).
 * GET /api/content/pages
 */
const listPages = asyncHandler(async (req, res) => {
  const pages = await ContentPage.find({ isPublished: true }, "-_id slug title updatedAt")
    .sort({ createdAt: 1, slug: 1 })
    .lean();
  res.json({ success: true, data: { pages } });
});

/**
 * One published page. Store-link placeholders ({appLinks.ios} /
 * {appLinks.android}) are filled from Settings.appLinks; links without a URL
 * are left out.
 * GET /api/content/pages/:slug
 */
const getPage = asyncHandler(async (req, res) => {
  const [page, settings] = await Promise.all([
    ContentPage.findOne(
      { slug: String(req.params.slug).toLowerCase(), isPublished: true },
      "-_id slug title intro sections updatedAt",
    ).lean(),
    CatalogService.getSettings(),
  ]);
  if (!page) {
    return res.status(404).json({ success: false, message: "Page not found" });
  }
  res.json({ success: true, data: { page: CatalogService.renderPage(page, settings) } });
});

/**
 * Active onboarding slides, in order.
 * GET /api/content/onboarding
 */
const listOnboarding = asyncHandler(async (req, res) => {
  const slides = await OnboardingSlide.find(
    { isActive: true },
    "title subtitle icon image order",
  )
    .sort({ order: 1, createdAt: 1 })
    .lean();
  res.json({ success: true, data: { slides } });
});

/**
 * Real headline numbers for the landing page.
 * GET /api/content/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const activeRestaurant = { status: "active", isDeleted: false };
  const [restaurants, reviews, liked, usedCuisines, activeCuisines] = await Promise.all([
    Restaurant.countDocuments(activeRestaurant),
    Review.countDocuments({ isDeleted: false }),
    Review.countDocuments({ isDeleted: false, sentiment: "liked" }),
    Restaurant.distinct("cuisines", activeRestaurant),
    Taxonomy.distinct("name", { type: "cuisine", isActive: true }),
  ]);

  // Cuisines actually served by at least one active restaurant.
  const active = new Set(activeCuisines);
  const cuisines = usedCuisines.filter((name) => active.has(name)).length;

  res.json({
    success: true,
    data: {
      stats: {
        restaurants,
        reviews,
        cuisines,
        likedPercent: reviews ? Math.round((liked / reviews) * 100) : 0,
      },
    },
  });
});

export { listFaqs, listPages, getPage, listOnboarding, getStats };
