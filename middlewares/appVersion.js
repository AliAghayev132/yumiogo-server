import { PlatformService, CatalogService } from "#services";

/**
 * API versioning + minimum supported app version.
 *
 * apiVersionAlias — /api/v1/* is the versioned name of today's API: it is
 *   rewritten to /api/* before anything else runs, so both spellings share
 *   routes, limits and policies. Every API response says `X-API-Version: 1`.
 *   A future breaking change ships as /api/v2 next to it.
 *
 * appVersionGate — the mobile app sends `X-App-Version: 1.4.0` (and
 *   `X-App-Platform: ios|android`). When Settings.appVersion.minSupported is
 *   set and the app is older, API calls answer
 *     426 { success:false, code:"APP_UPDATE_REQUIRED", message,
 *           data:{ minSupported, latest, storeUrl } }
 *   Requests without the header (older builds, admin, web) are never blocked;
 *   the app can also compare GET /api/catalog → config.appVersion itself.
 *   Always open: health, catalog, content, admin, auth/logout.
 */

const API_VERSION = "1";
const ALWAYS_OPEN = [/^\/health\/?$/, /^\/catalog(\/|$)/, /^\/content(\/|$)/, /^\/admin(\/|$)/, /^\/auth\/logout\/?$/];

const apiVersionAlias = (req, res, next) => {
  if (req.url === "/api/v1" || req.url.startsWith("/api/v1/") || req.url.startsWith("/api/v1?")) {
    req.url = `/api${req.url.slice("/api/v1".length)}`;
  }
  if (req.url.startsWith("/api")) res.setHeader("X-API-Version", API_VERSION);
  next();
};

const appVersionGate = async (req, res, next) => {
  try {
    const version = String(req.headers["x-app-version"] || "").trim();
    if (!version || !CatalogService.isAppVersion(version)) return next();
    if (ALWAYS_OPEN.some((rx) => rx.test(req.path))) return next();

    const settings = await PlatformService.settings();
    const { minSupported, latest, storeUrls } = CatalogService.appVersion(settings);
    if (!minSupported || CatalogService.compareVersions(version, minSupported) >= 0) return next();

    const platform = String(req.headers["x-app-platform"] || "").toLowerCase();
    return res.status(426).json({
      success: false,
      code: "APP_UPDATE_REQUIRED",
      message: "This version of Yumio is no longer supported. Please update the app to continue.",
      data: { minSupported, latest, storeUrl: storeUrls[platform] || "" },
    });
  } catch (_error) {
    // Settings unreadable → never lock the app out.
    return next();
  }
};

export { API_VERSION, apiVersionAlias, appVersionGate };
