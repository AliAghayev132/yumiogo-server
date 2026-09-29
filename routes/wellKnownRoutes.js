import { Router } from "#constants";
import { config } from "#config";

/**
 * /.well-known — iOS Universal Links and Android App Links for the share
 * landings (/list/*, /restaurant/*, /invite/*, /review/*), so a tapped share
 * link opens the installed app instead of the browser.
 *
 *   GET /.well-known/apple-app-site-association   (APPLE_TEAM_ID + IOS_BUNDLE_ID)
 *   GET /.well-known/assetlinks.json              (ANDROID_PACKAGE + ANDROID_CERT_SHA256)
 *
 * Plain application/json, no redirects, publicly cacheable. Answers 404 while
 * the platform's env values are missing (a half-filled file would be rejected
 * by the OS anyway). The app side needs associatedDomains (iOS) and an
 * autoVerify intent filter (Android) for the same domain.
 */
const WellKnownRouter = Router();

const notConfigured = (res, keys) =>
  res.status(404).json({ success: false, message: `Not configured (${keys})`, code: "NOT_CONFIGURED" });

const sendJson = (res, body) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.type("application/json").send(JSON.stringify(body));
};

const appleAssociation = (req, res) => {
  const { appleTeamId, iosBundleId, linkPaths } = config.mobileApp;
  if (!appleTeamId || !iosBundleId) return notConfigured(res, "APPLE_TEAM_ID");
  const appID = `${appleTeamId}.${iosBundleId}`;
  return sendJson(res, {
    applinks: {
      apps: [],
      details: [
        {
          // iOS 13+ format …
          appIDs: [appID],
          components: linkPaths.map((pattern) => ({ "/": pattern })),
          // … and the legacy keys for older iOS versions.
          appID,
          paths: linkPaths,
        },
      ],
    },
  });
};

WellKnownRouter.get("/apple-app-site-association", appleAssociation);
// Older iOS versions also look for it at the domain root.
const RootAppleRouter = Router();
RootAppleRouter.get("/apple-app-site-association", appleAssociation);

WellKnownRouter.get("/assetlinks.json", (req, res) => {
  const { androidPackage, androidCertSha256 } = config.mobileApp;
  if (!androidPackage || !androidCertSha256.length) return notConfigured(res, "ANDROID_CERT_SHA256");
  return sendJson(res, [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: androidPackage,
        sha256_cert_fingerprints: androidCertSha256,
      },
    },
  ]);
});

export { WellKnownRouter, RootAppleRouter };
