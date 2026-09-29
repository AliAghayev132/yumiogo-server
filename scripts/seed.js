import { mongoDBService, SeedService, PlatformService } from "#services";

/**
 * Yumio demo seeder — replaces the demo data (documents tagged isSeed) with a
 * fresh, consistent batch; real data is never touched.
 *
 *   npm run seed            load (or reload) the mock data
 *   npm run seed -- --clear remove the mock data only
 *
 * The data + logic live in SeedService (shared with the admin panel's
 * Settings → Data card). Refused in production unless ENABLE_DEMO_SEED=true.
 */
const LABELS = {
  restaurants: "restaurants",
  menuCategories: "menu categories",
  menuItems: "menu items",
  users: "users",
  invites: "accepted invites",
  followEdges: "follow edges",
  lists: "favourite lists",
  listItems: "saved places",
  listSaves: "list saves",
  reviews: "reviews",
  likes: "review likes",
  comments: "comments",
  replies: "of them replies",
  shares: "shares",
  restaurantFollows: "restaurant follows",
  reports: "reports",
  labelRequests: "label requests",
  notifications: "notifications",
  notificationTypes: "notification types",
  views: "restaurant views",
  searches: "search history entries",
};

const print = (counts) =>
  Object.entries(counts).forEach(([key, value]) => console.log(`   ${String(value).padStart(5)}  ${LABELS[key] || key}`));

const seed = async () => {
  try {
    if (!PlatformService.isDemoDataEnabled()) {
      console.error("❌ Demo data is disabled in production (set ENABLE_DEMO_SEED=true to allow it).");
      process.exit(1);
    }
    const clear = process.argv.includes("--clear");

    await mongoDBService.connect();
    console.log("✅ Connected to MongoDB\n");

    if (clear) {
      console.log("🧹 Removing the demo data...\n");
      print(await SeedService.clearAll());
      console.log("\n✅ Demo data removed");
    } else {
      console.log("🌱 Loading the demo data...\n");
      const started = Date.now();
      print(await SeedService.seedAll());
      console.log(`\n🎉 Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      if (PlatformService.isDevelopment()) {
        console.log(`   Demo user: lala@yumio.app / ${SeedService.DEMO_PASSWORD}`);
      }
    }

    await mongoDBService.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Seed failed:", error);
    await mongoDBService.disconnect();
    process.exit(1);
  }
};

seed();
