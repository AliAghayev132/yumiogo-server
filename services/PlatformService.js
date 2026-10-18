import { Settings, User, Notification } from "#models";
import { APP_LANGUAGES, APP_LANGUAGE_LABELS } from "#constants";
import socketService from "./SocketService.js";

/**
 * PlatformService — platform-wide switches from the admin Settings page and
 * the admin alert fan-out.
 *
 *  - settings(): the Settings singleton as a plain object, cached for a few
 *    seconds (the maintenance gate reads it on every API request).
 *  - maintenance / new-user approval / restaurant approval flags.
 *  - demo data (seed / reset) availability + the typed confirmations.
 *  - alertAdmins(): "system" notifications + a socket push to every admin
 *    (new users are gated by Settings.newUserAlerts; report alerts are sent
 *    by the reports module, gated by Settings.reportAlerts).
 */

const CACHE_TTL_MS = 5000;

const DEFAULT_MAINTENANCE_MESSAGE =
  "Yumio is getting a few improvements. Please check back soon.";
// The default message in az / ru (used while the admin message is the default).
const DEFAULT_MAINTENANCE_MESSAGES = {
  az: "Yumio bir neçə təkmilləşdirmə alır. Zəhmət olmasa, bir azdan yenidən yoxlayın.",
  ru: "Yumio становится лучше. Пожалуйста, загляните чуть позже.",
};

// Typed confirmations the admin must send to POST /admin/seed and /admin/reset.
const DEMO_CONFIRMATIONS = {
  seed: "SEED DEMO DATA",
  reset: "DELETE DEMO DATA",
};

const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();

class PlatformService {
  static cache = null;
  static cachedAt = 0;
  static loading = null;

  static DEMO_CONFIRMATIONS = DEMO_CONFIRMATIONS;
  static DEFAULT_MAINTENANCE_MESSAGE = DEFAULT_MAINTENANCE_MESSAGE;

  /** Settings as a plain object (schema defaults applied), cached briefly. */
  static async settings() {
    if (this.cache && Date.now() - this.cachedAt < CACHE_TTL_MS) return this.cache;
    if (!this.loading) {
      this.loading = Settings.getSingleton()
        .then((doc) => {
          this.cache = doc.toObject();
          this.cachedAt = Date.now();
          return this.cache;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  /** Drop the cache (call after saving Settings). */
  static invalidate() {
    this.cache = null;
    this.cachedAt = 0;
  }

  /** { enabled, message } */
  static async maintenance() {
    const s = await this.settings();
    const messages = Object.fromEntries(
      Object.entries(s.translations || {}).map(([lang, entry]) => [lang, entry?.maintenanceMessage || ""]),
    );
    return {
      enabled: !!s.maintenanceMode,
      message: s.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE,
      // az / ru versions the admin wrote ("" → the English message).
      messages,
    };
  }

  /** Status a newly registered account starts with. */
  static async newUserStatus() {
    const s = await this.settings();
    return s.newUserApproval ? "pending" : "active";
  }

  static async restaurantApprovalRequired() {
    const s = await this.settings();
    return !!s.restaurantApproval;
  }

  /** Languages offered by the "Default language" select. */
  static languages() {
    return APP_LANGUAGES.map((code) => ({ code, label: APP_LANGUAGE_LABELS[code] || code }));
  }

  // ------------------------------------------------------------ demo data

  /**
   * Seed / reset of demo data is a development tool: allowed when NODE_ENV is
   * not "production", or when ENABLE_DEMO_SEED=true is set explicitly.
   */
  static isDemoDataEnabled() {
    return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_SEED === "true";
  }

  /** Known-password demo accounts only exist outside production. */
  static isDevelopment() {
    return process.env.NODE_ENV !== "production";
  }

  // --------------------------------------------------------- admin alerts

  static async activeAdminIds() {
    const admins = await User.find(
      { role: "admin", status: "active", isDeleted: false },
      "_id",
    ).lean();
    return admins.map((a) => a._id);
  }

  /**
   * Notify every active admin: a "system" notification (header bell) and an
   * `admin:alert` socket event. Never throws.
   *   alertAdmins({ kind, title, message, actor?, data? })
   */
  static async alertAdmins({ kind, title, message, actor = null, data = {} }) {
    try {
      const recipients = await this.activeAdminIds();
      const payload = { type: "system", actor, title, message, data: { kind, ...data } };
      await Notification.notifyMany(recipients, payload);
      socketService.emitToAdmins("admin:alert", {
        kind,
        title,
        message,
        ...data,
        at: new Date().toISOString(),
      });
      return recipients.length;
    } catch (error) {
      console.error("Admin alert error:", error.message);
      return 0;
    }
  }

  /** "New user alerts" toggle: a new account was created. */
  static async alertNewUser(user) {
    const s = await this.settings();
    if (!s.newUserAlerts || !user) return 0;
    const pending = user.status === "pending";
    return this.alertAdmins({
      kind: "new_user",
      title: pending ? "New user awaiting approval" : "New user",
      message: `${fullName(user) || user.email} ${pending ? "signed up and is awaiting approval" : "registered as a new user"}.`,
      actor: user._id,
      data: { userId: String(user._id), link: `/dashboard/users?user=${user._id}` },
    });
  }

  /**
   * Push the maintenance switch to every connected client:
   * { maintenance, message (English), messages: { en, az, ru } } — the app shows
   * messages[its language] (an empty az / ru text falls back to English).
   * `messages` defaults to the az / ru texts saved in Settings.
   */
  static async broadcastMaintenance({ enabled, message, messages = null }) {
    const english = message || DEFAULT_MAINTENANCE_MESSAGE;
    let translated = messages;
    if (!translated) {
      try {
        this.invalidate();
        translated = (await this.maintenance()).messages;
      } catch (error) {
        console.error("Maintenance broadcast: settings read failed:", error.message);
        translated = {};
      }
    }
    const isDefault = english === DEFAULT_MAINTENANCE_MESSAGE;
    const byLanguage = Object.fromEntries(
      APP_LANGUAGES.map((lang) => {
        if (lang === "en") return [lang, english];
        const text = String(translated?.[lang] || "").trim();
        return [lang, text || (isDefault && DEFAULT_MAINTENANCE_MESSAGES[lang]) || english];
      }),
    );
    try {
      socketService.broadcast("app:maintenance", {
        maintenance: !!enabled,
        message: english,
        messages: byLanguage,
      });
    } catch (error) {
      // Callers fire and forget — never an unhandled rejection.
      console.error("Maintenance broadcast failed:", error.message);
    }
  }
}

export { PlatformService };
