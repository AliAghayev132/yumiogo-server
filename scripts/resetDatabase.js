import { mongoDBService } from "#services";
import { User, OTP, Post } from "#models";

/**
 * Reset Database Script
 * Clears all application collections.
 *
 * Usage:
 *   node scripts/resetDatabase.js
 *
 * WARNING: This deletes all data and cannot be undone. Development/test only.
 */
const resetDatabase = async () => {
  try {
    console.log("🚀 Database reset started...\n");

    await mongoDBService.connect();
    console.log("✅ Connected to MongoDB\n");

    const models = [
      { name: "User", model: User },
      { name: "OTP", model: OTP },
      { name: "Post", model: Post },
    ];

    console.log(`📊 Collections to clear: ${models.length}\n`);

    let totalDeleted = 0;

    for (const { name, model } of models) {
      try {
        const result = await model.deleteMany({});
        console.log(`🗑️  ${name}: ${result.deletedCount} documents deleted`);
        totalDeleted += result.deletedCount;
      } catch (error) {
        console.error(`❌ Error clearing ${name}:`, error.message);
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Database reset complete!");
    console.log(`📊 Total documents deleted: ${totalDeleted}`);
    console.log("=".repeat(50) + "\n");

    await mongoDBService.disconnect();
    console.log("👋 Disconnected from MongoDB");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Database reset failed:", error);
    await mongoDBService.disconnect();
    process.exit(1);
  }
};

resetDatabase();
