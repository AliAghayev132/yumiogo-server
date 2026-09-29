import { mongoDBService, SeedService, DataWipeService } from "#services";

/**
 * Reset the Yumio database.
 *
 * Usage:
 *   node scripts/resetDatabase.js --demo-only   remove only the demo data (isSeed)
 *   node scripts/resetDatabase.js --yes         delete all app data (admins, catalog
 *                                               and settings are kept)
 *   node scripts/resetDatabase.js --yes --all   … and reset the catalog, content and
 *                                               settings to the defaults
 *
 * The full wipe is DataWipeService.wipeAll() — the same as the admin panel's
 * Settings → Data → "Delete all data" (uploaded files are deleted too). It is
 * refused when NODE_ENV=production unless ENABLE_DATA_WIPE=true. Cannot be undone.
 */

const args = new Set(process.argv.slice(2));

const resetDatabase = async () => {
  const demoOnly = args.has("--demo-only");
  if (!demoOnly && !DataWipeService.isEnabled()) {
    console.error("❌ db:reset is disabled in production (set ENABLE_DATA_WIPE=true to allow it).");
    process.exit(1);
  }
  if (!demoOnly && !args.has("--yes")) {
    console.error(
      [
        "This deletes Yumio data and cannot be undone.",
        "  --demo-only   remove only the demo (seed) data",
        "  --yes         delete all app data (admins, catalog and settings are kept)",
        "  --yes --all   also reset the catalog, content and settings to the defaults",
      ].join("\n"),
    );
    process.exit(1);
  }

  try {
    await mongoDBService.connect();
    console.log("✅ Connected to MongoDB\n");

    if (demoOnly) {
      const counts = await SeedService.clearAll();
      console.log("🧹 Demo data removed:", counts);
    } else {
      const counts = await DataWipeService.wipeAll({ includeCatalog: args.has("--all") });
      console.log("🗑️  Deleted:", counts);
      console.log("\n✅ Database reset complete");
    }

    await mongoDBService.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Database reset failed:", error);
    await mongoDBService.disconnect();
    process.exit(1);
  }
};

resetDatabase();
