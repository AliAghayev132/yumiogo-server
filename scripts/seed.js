import { mongoDBService, SeedService } from "#services";

/**
 * Yumio unified seeder — seeds EVERYTHING in one command.
 *
 *   npm run seed
 *
 * The actual data + logic lives in SeedService (shared with the admin panel's
 * Seed button). This script just manages the DB connection for CLI use.
 */
const seed = async () => {
  try {
    console.log("🌱 Yumio unified seed starting...\n");
    await mongoDBService.connect();
    console.log("✅ Connected to MongoDB\n");

    const counts = await SeedService.seedAll();

    console.log(`✅ ${counts.restaurants} restaurants`);
    console.log(`✅ ${counts.users} users (password: Password123!)`);
    console.log(`✅ ${counts.reviews} reviews`);
    console.log(`✅ ${counts.lists} public favorite lists`);
    console.log(`✅ ${counts.followEdges} follow edges`);
    console.log(`✅ ${counts.reports} reports (5 open)`);

    console.log("\n🎉 Seed complete!");
    console.log("   Admin:  admin@yumio.app / Admin123!");
    console.log("   User:   lala@yumio.app  / Password123!");

    await mongoDBService.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Seed failed:", error);
    await mongoDBService.disconnect();
    process.exit(1);
  }
};

seed();
