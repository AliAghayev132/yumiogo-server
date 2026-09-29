import { User } from "#models";
import { config } from "#config";
import { HashService } from "./HashService.js";

// The development fallback password (see config.defaultAdmin); never allowed in production.
const DEV_DEFAULT_PASSWORD = "Admin123!";

/**
 * Make sure an active admin exists on boot.
 *
 *  - An active, non-deleted admin exists → nothing to do.
 *  - The configured default admin exists but is suspended / deleted → it is
 *    re-activated (a normal user holding that e-mail is never promoted).
 *  - Otherwise a new admin is created from DEFAULT_ADMIN_EMAIL /
 *    DEFAULT_ADMIN_PASSWORD. In production the password must be set and must
 *    not be the public development default; the password is never logged.
 */
const bootstrapAdmin = async () => {
  try {
    const activeAdmin = await User.findOne({ role: "admin", status: "active", isDeleted: false });
    if (activeAdmin) {
      console.log("✅ Admin account present:", activeAdmin.email);
      return;
    }

    const email = String(config.defaultAdmin.email || "").trim().toLowerCase();
    const password = config.defaultAdmin.password;
    const isProduction = process.env.NODE_ENV === "production";

    if (!email) {
      console.error("❌ No active admin and DEFAULT_ADMIN_EMAIL is not set — cannot create one.");
      return;
    }

    const existing = await User.findOne({ email });
    if (existing) {
      if (existing.role !== "admin") {
        console.error(
          `❌ No active admin, and ${email} belongs to a regular user — not promoting it. ` +
            "Set DEFAULT_ADMIN_EMAIL to an unused address and restart.",
        );
        return;
      }
      existing.status = "active";
      existing.isDeleted = false;
      existing.statusReason = "";
      existing.suspendedUntil = null;
      await existing.save();
      console.log("🔓 Default admin re-activated:", existing.email);
      return;
    }

    if (isProduction && (!password || password === DEV_DEFAULT_PASSWORD)) {
      console.error(
        [
          "",
          "❌ No active admin exists and DEFAULT_ADMIN_PASSWORD is missing or uses the public default.",
          "   Set a strong DEFAULT_ADMIN_PASSWORD in server/.env and restart to create the admin.",
          "",
        ].join("\n"),
      );
      return;
    }

    const admin = await User.create({
      firstName: "Super",
      lastName: "Admin",
      email,
      password: await HashService.hashPassword(password || DEV_DEFAULT_PASSWORD),
      role: "admin",
      status: "active",
    });

    console.log("🚀 Default admin created:", admin.email);
    console.log("   Password: the DEFAULT_ADMIN_PASSWORD value — change it after the first login.");
  } catch (error) {
    console.error("❌ Error ensuring the default admin:", error.message);
  }
};

export { bootstrapAdmin };
