import { User } from "#models";
import { HashService } from "#services";
import { config } from "#config";

/**
 * Create a default admin user on first boot if none exists.
 * Credentials come from DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD.
 */
const bootstrapAdmin = async () => {
  try {
    const existingAdmin = await User.findOne({ role: "admin" });

    if (existingAdmin) {
      console.log("✅ Admin already exists:", existingAdmin.email);
      return;
    }

    const hashedPassword = await HashService.hashPassword(
      config.defaultAdmin.password,
    );

    const admin = await User.create({
      firstName: "Default",
      lastName: "Admin",
      email: config.defaultAdmin.email,
      password: hashedPassword,
      role: "admin",
      status: "active",
    });

    console.log("🚀 Default admin created successfully!");
    console.log("   Email:", admin.email);
    console.log("   Password:", config.defaultAdmin.password);
    console.log("   ⚠️  Please change the password after first login!");
  } catch (error) {
    console.error("❌ Error creating default admin:", error.message);
  }
};

export { bootstrapAdmin };
