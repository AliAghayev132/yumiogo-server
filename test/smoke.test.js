/**
 * Smoke test — `npm test` (node:test, no extra packages).
 *
 * Boots the real app.js as a child process against a THROWAWAY database
 * (yumio_test_<random> on TEST_MONGODB_URI, default mongodb://127.0.0.1:27017)
 * in a temporary working directory (its own uploads/ and a stub client build,
 * with the orphan-upload sweeps disabled: NODE_ENV=test + DISABLE_UPLOAD_SWEEP),
 * hits the key public / auth / admin endpoints the mobile and admin apps rely
 * on, and drops the database afterwards. It never reads server/.env and never
 * touches the real database or the real uploads folder.
 *
 *   npm test
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MONGO_BASE = String(process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017").replace(/\/+$/, "");
const DB_NAME = `yumio_test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const MONGODB_URI = `${MONGO_BASE}/${DB_NAME}`;
const ADMIN = { email: "admin@smoke.test", password: "SmokeAdmin1!" };
const USER = { email: `user.${Date.now()}@smoke.test`, password: "Smoke123!", firstName: "Smoke", lastName: "Tester" };

if (!/^mongodb(\+srv)?:\/\/[^/]+$/.test(MONGO_BASE) || !DB_NAME.startsWith("yumio_test_")) {
  throw new Error("TEST_MONGODB_URI must be a server URI without a database name (e.g. mongodb://127.0.0.1:27017)");
}

let child;
let baseUrl;
let workDir;
let output = "";

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch wrapper → { status, headers, body (JSON or text) } */
const call = async (method, url, { token, body, headers = {} } = {}) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    // HTML / text response
  }
  return { status: res.status, headers: res.headers, body: parsed };
};

/** The last dev OTP the server printed for `email` (of `type`, when given). */
const otpFor = async (email, type) => {
  for (let i = 0; i < 50; i += 1) {
    const matches = [...output.matchAll(/\[DEV\] OTP for (\S+) \(([^)]+)\): (\d+)/g)].filter(
      (m) => m[1] === email && (!type || m[2] === type),
    );
    if (matches.length) return matches.at(-1)[3];
    await sleep(100);
  }
  throw new Error(`No OTP printed for ${email}`);
};

/** How many dev OTPs the server printed for `email` so far. */
const otpCount = (email) =>
  [...output.matchAll(/\[DEV\] OTP for (\S+) \([^)]+\): (\d+)/g)].filter((m) => m[1] === email).length;

before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "yumio-smoke-"));
  // Stub admin-web build for the SPA fallback / link previews.
  fs.mkdirSync(path.join(workDir, "dist"));
  fs.writeFileSync(
    path.join(workDir, "dist", "index.html"),
    [
      "<!doctype html>",
      "<html lang=\"en\">",
      "  <head>",
      "    <meta charset=\"UTF-8\" />",
      "    <title>Yumio Admin</title>",
      "    <meta name=\"description\" content=\"Yumio admin panel\" />",
      "    <meta name=\"robots\" content=\"noindex, nofollow\" />",
      "  </head>",
      "  <body><div id=\"root\"></div></body>",
      "</html>",
    ].join("\n"),
  );

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(SERVER_DIR, "app.js")], {
    cwd: workDir, // uploads/ and .env lookups stay inside the temp folder
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      // Belt and braces: the orphan-upload sweeps judge files against the
      // connected (throwaway) DB — they are off for NODE_ENV=test and here.
      DISABLE_UPLOAD_SWEEP: "true",
      APPLE_TEAM_ID: "ABCDE12345",
      ANDROID_CERT_SHA256: "aa:bb:cc",
      PORT: String(port),
      MONGODB_URI,
      DEFAULT_ADMIN_EMAIL: ADMIN.email,
      DEFAULT_ADMIN_PASSWORD: ADMIN.password,
      APP_URL: baseUrl,
      CLIENT_DIST: path.join(workDir, "dist"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${output}`);
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (_error) {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`Server did not become healthy:\n${output}`);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  // Drop ONLY the throwaway database this run created.
  if (DB_NAME.startsWith("yumio_test_")) {
    const conn = await mongoose.createConnection(MONGODB_URI).asPromise();
    await conn.dropDatabase();
    await conn.close();
  }
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

test("health, API version alias and 404 envelope", async () => {
  const health = await call("GET", "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.success, true);
  assert.equal(health.headers.get("x-api-version"), "1");

  const v1 = await call("GET", "/api/v1/health");
  assert.equal(v1.status, 200);

  const missing = await call("GET", "/api/definitely-missing");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "ENDPOINT_NOT_FOUND");
});

test("universal links / app links files", async () => {
  const apple = await call("GET", "/.well-known/apple-app-site-association");
  assert.equal(apple.status, 200);
  assert.match(apple.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(apple.body.applinks.details[0].appIDs, ["ABCDE12345.com.aliaghayev.yumio"]);
  assert.ok(apple.body.applinks.details[0].paths.includes("/list/*"));
  const root = await call("GET", "/apple-app-site-association");
  assert.equal(root.status, 200);

  const android = await call("GET", "/.well-known/assetlinks.json");
  assert.equal(android.status, 200);
  assert.equal(android.body[0].target.package_name, "com.aliaghayev.yumio");
  assert.deepEqual(android.body[0].target.sha256_cert_fingerprints, ["AA:BB:CC"]);
});

test("catalog exposes app config incl. appVersion", async () => {
  const res = await call("GET", "/api/catalog");
  assert.equal(res.status, 200);
  const { config } = res.body.data;
  assert.ok(Array.isArray(res.body.data.cuisines));
  assert.deepEqual(Object.keys(config.appVersion).sort(), ["latest", "minSupported", "storeUrls"]);
  assert.equal(config.appVersion.minSupported, "");
});

test("shipped defaults carry az / ru texts (filled on boot), English unchanged", async () => {
  const turkish = (res) => res.body.data.cuisines.find((c) => c.key === "Turkish");
  const en = await call("GET", "/api/catalog");
  const az = await call("GET", "/api/catalog", { headers: { "Accept-Language": "az" } });
  const ru = await call("GET", "/api/catalog", { headers: { "Accept-Language": "ru" } });
  assert.equal(turkish(en).name, "Turkish");
  assert.equal(turkish(az).name, "Türk");
  assert.equal(turkish(ru).name, "Турецкая");
  assert.equal(en.body.data.config.surprise.title, "Surprise me");
  assert.equal(az.body.data.config.surprise.title, "Məni təəccübləndir");

  const page = await call("GET", "/api/content/pages/cookies", { headers: { "Accept-Language": "ru" } });
  assert.equal(page.body.data.page.title, "Политика использования cookie");
});

test("coded errors are localized by Accept-Language, codes unchanged", async () => {
  const body = { email: "nobody@smoke.test", password: "Wrong123!" };
  const en = await call("POST", "/api/auth/login", { body });
  assert.equal(en.status, 401);
  assert.equal(en.body.code, "INVALID_CREDENTIALS");
  assert.equal(en.body.message, "Invalid email or password");

  const az = await call("POST", "/api/auth/login", { body, headers: { "Accept-Language": "az-AZ,az;q=0.9,en;q=0.5" } });
  assert.equal(az.body.code, "INVALID_CREDENTIALS");
  assert.equal(az.body.message, "E-poçt və ya şifrə yanlışdır");
  assert.equal(az.headers.get("content-language"), "az");

  const ru = await call("POST", "/api/auth/login", { body, headers: { "Accept-Language": "ru" } });
  assert.equal(ru.body.message, "Неверный адрес электронной почты или пароль");

  const unsupported = await call("GET", "/api/definitely-missing", { headers: { "Accept-Language": "de" } });
  assert.equal(unsupported.body.message, "Endpoint not found");
});

// Shared state of the flow below.
const state = {};

test("sign-up with OTP, then /auth/me", async () => {
  const config = await call("GET", "/api/auth/config");
  assert.equal(config.status, 200);
  assert.equal(config.body.data.otp.codeLength, 4);

  const register = await call("POST", "/api/auth/register", { body: { ...USER, acceptTerms: true } });
  assert.equal(register.status, 200, JSON.stringify(register.body));
  const code = await otpFor(USER.email);
  assert.equal(code.length, 4);

  const verify = await call("POST", "/api/auth/verify-otp", { body: { email: USER.email, code } });
  assert.equal(verify.status, 201, JSON.stringify(verify.body));
  state.user = verify.body.data.tokens;

  const me = await call("GET", "/api/auth/me", { token: state.user.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, USER.email);

  const weak = await call("POST", "/api/auth/register", {
    body: { ...USER, email: `weak.${Date.now()}@smoke.test`, password: "short", acceptTerms: true },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, "PASSWORD_WEAK");
});

test("review photo upload: real images only (magic bytes), coded errors", async () => {
  // 1×1 transparent PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = async (bytes, name, type) => {
    const form = new FormData();
    form.append("files", new Blob([bytes], { type }), name);
    const res = await fetch(`${baseUrl}/api/uploads/reviews`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.user.accessToken}` },
      body: form,
    });
    return { status: res.status, body: await res.json() };
  };

  const ok = await upload(png, "photo.png", "image/png");
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.match(ok.body.data.urls[0], /^uploads\/reviews\/[a-f0-9]{24}\/[a-f0-9]+\.png$/);

  const fake = await upload(Buffer.from("<script>alert(1)</script>"), "evil.png", "image/png");
  assert.equal(fake.status, 415);
  assert.equal(fake.body.code, "FILE_TYPE_NOT_ALLOWED");
});

test("admin sign-in, invalid id → 400 INVALID_ID, restaurant create + search", async () => {
  const login = await call("POST", "/api/auth/login", { body: ADMIN });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  state.admin = login.body.data.tokens;

  const badId = await call("GET", "/api/admin/users/not-an-id", { token: state.admin.accessToken });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.code, "INVALID_ID");

  const created = await call("POST", "/api/restaurants", {
    token: state.admin.accessToken,
    body: {
      name: `Smoke <Bistro> & "Grill"`,
      description: "Test restaurant for the smoke test.",
      address: "1 Test Street",
      avgPrice: 20,
      location: { type: "Point", coordinates: [49.8671, 40.4093] },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  state.restaurant = created.body.data.restaurant;

  const search = await call("GET", "/api/restaurants/search?q=smoke%20bistro");
  assert.equal(search.status, 200);
  assert.ok(search.body.data.restaurants.some((r) => r._id === state.restaurant._id));

  const detail = await call("GET", `/api/restaurants/${state.restaurant.slug}`);
  assert.equal(detail.status, 200);

  // Promotions can carry an end date (must be in the future).
  const past = await call("PUT", `/api/restaurants/${state.restaurant._id}`, {
    token: state.admin.accessToken,
    body: { discountPercent: 20, discountEndsAt: "2001-01-01" },
  });
  assert.equal(past.status, 400);
  const ends = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const promo = await call("PUT", `/api/restaurants/${state.restaurant._id}`, {
    token: state.admin.accessToken,
    body: { discountPercent: 20, discountEndsAt: ends },
  });
  assert.equal(promo.status, 200, JSON.stringify(promo.body));
  assert.equal(promo.body.data.restaurant.discountEndsAt, ends);
});

test("admin content in en / az / ru: English required, az / ru optional, English fallback", async () => {
  const token = state.admin.accessToken;
  const az = { "Accept-Language": "az" };

  const bad = await call("POST", "/api/admin/taxonomies", {
    token,
    body: { type: "cuisine", name: "Broken", translations: { az: { name: 5 } } },
  });
  assert.equal(bad.status, 400);

  const created = await call("POST", "/api/admin/taxonomies", {
    token,
    body: { type: "cuisine", name: "Smoke Fusion", translations: { az: { name: "Tüstü füzyon" }, ru: { name: "" } } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const find = (res) => res.body.data.cuisines.find((c) => c.key === "Smoke Fusion");
  const inAz = find(await call("GET", "/api/catalog", { headers: az }));
  assert.equal(inAz.name, "Tüstü füzyon");
  assert.equal(inAz.translations, undefined);
  const inRu = find(await call("GET", "/api/catalog", { headers: { "Accept-Language": "ru" } }));
  assert.equal(inRu.name, "Smoke Fusion"); // empty translation → English
  const inEn = find(await call("GET", "/api/catalog"));
  assert.equal(inEn.name, "Smoke Fusion");

  // Admin routes keep every language for editing.
  const adminList = await call("GET", "/api/admin/taxonomies?type=cuisine", { token, headers: az });
  const raw = adminList.body.data.items.find((i) => i.name === "Smoke Fusion");
  assert.equal(raw.translations.az.name, "Tüstü füzyon");

  // Restaurants: az texts, English fallback, filters accept the az name.
  const updated = await call("PUT", `/api/restaurants/${state.restaurant._id}`, {
    token,
    headers: { "X-Content-Mode": "raw" },
    body: { cuisines: ["Tüstü füzyon"], translations: { az: { description: "Smoke testi üçün restoran." } } },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.deepEqual(updated.body.data.restaurant.cuisines, ["Smoke Fusion"]);
  assert.equal(updated.body.data.restaurant.translations.az.description, "Smoke testi üçün restoran.");

  const detail = await call("GET", `/api/restaurants/${state.restaurant._id}`, { headers: az });
  const restaurant = detail.body.data.restaurant;
  assert.equal(restaurant.description, "Smoke testi üçün restoran.");
  assert.equal(restaurant.name, state.restaurant.name);
  assert.equal(restaurant.translations, undefined);

  const filtered = await call("GET", `/api/restaurants?cuisine=${encodeURIComponent("Tüstü füzyon")}`, { headers: az });
  assert.ok(filtered.body.data.restaurants.some((r) => r._id === state.restaurant._id));

  // Keyed settings lists.
  const catalog = await call("GET", "/api/catalog");
  const sortKey = catalog.body.data.config.sortOptions[0].key;
  const settings = await call("PUT", "/api/admin/settings", {
    token,
    body: { sortOptions: [{ key: sortKey, translations: { az: { label: "Ən uyğun" } } }] },
  });
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  const sortAz = (await call("GET", "/api/catalog", { headers: az })).body.data.config.sortOptions;
  assert.equal(sortAz.find((o) => o.key === sortKey).label, "Ən uyğun");
});

test("link previews: Open Graph tags on share landings, escaped; admin stays noindex", async () => {
  const page = await call("GET", `/restaurant/${state.restaurant.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /<meta property="og:title" content="Smoke &lt;Bistro&gt; &amp; &quot;Grill&quot; — Yumio" \/>/);
  assert.match(page.body, /<meta property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/uploads\//);
  assert.match(page.body, /<meta name="robots" content="index, follow" \/>/);
  assert.doesNotMatch(page.body, /Yumio Admin/);
  assert.doesNotMatch(page.body, /<Bistro>/);

  const list = await call("POST", "/api/favorites", {
    token: state.user.accessToken,
    body: { name: "Smoke picks", privacy: "public", restaurant: state.restaurant._id },
  });
  assert.equal(list.status, 201, JSON.stringify(list.body));
  const listPage = await call("GET", `/list/${list.body.data.list.shareSlug}`);
  assert.match(listPage.body, /og:title" content="Smoke picks — Yumio"/);
  assert.match(listPage.body, /1 restaurant: Smoke &lt;Bistro&gt;/);

  const invite = await call("GET", "/api/users/me/invite", { token: state.user.accessToken });
  assert.equal(invite.status, 200);
  const invitePage = await call("GET", `/invite/${invite.body.data.code}`);
  assert.match(invitePage.body, /Smoke invited you to Yumio/);

  const admin = await call("GET", "/dashboard/users");
  assert.match(admin.body, /<title>Yumio Admin<\/title>/);
  assert.match(admin.body, /noindex, nofollow/);

  const unknown = await call("GET", "/restaurant/does-not-exist");
  assert.match(unknown.body, /<title>Yumio Admin<\/title>/);
  state.list = list.body.data.list;
});

test("admin list moderation: find, inspect, remove", async () => {
  const found = await call("GET", "/api/admin/lists?search=smoke%20picks", { token: state.admin.accessToken });
  assert.equal(found.status, 200);
  assert.ok(found.body.data.lists.some((l) => l._id === state.list._id));

  const detail = await call("GET", `/api/admin/lists/${state.list._id}`, { token: state.admin.accessToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.list.items.length, 1);

  const removed = await call("DELETE", `/api/admin/lists/${state.list._id}`, {
    token: state.admin.accessToken,
    body: { reason: "Smoke test" },
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const again = await call("DELETE", `/api/admin/lists/${state.list._id}`, { token: state.admin.accessToken });
  assert.equal(again.status, 409);

  // The owner's notice is rendered in the reader's language (stored English is the fallback).
  const notice = async (lang) => {
    const res = await call("GET", "/api/notifications", { token: state.user.accessToken, headers: { "Accept-Language": lang } });
    return res.body.data.notifications.find((n) => n.data?.i18n?.key === "list_removed");
  };
  assert.equal((await notice("en")).message, 'Your list "Smoke picks" was removed by a moderator. Reason: Smoke test');
  const az = await notice("az");
  assert.equal(az.title, "Siyahı silindi");
  assert.equal(az.message, "«Smoke picks» siyahınız moderator tərəfindən silindi. Səbəb: Smoke test");

  const shared = await call("GET", `/api/favorites/share/${state.list.shareSlug}`);
  assert.equal(shared.status, 404);
  const forbidden = await call("GET", "/api/admin/lists", { token: state.user.accessToken });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "FORBIDDEN");
});

test("minimum app version gate (426 only for older apps that send X-App-Version)", async () => {
  const set = await call("PUT", "/api/admin/settings", {
    token: state.admin.accessToken,
    body: { appVersion: { minSupported: "2.0.0", latest: "2.1.0" } },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));

  const old = await call("GET", "/api/restaurants/search", { headers: { "X-App-Version": "1.9.9" } });
  assert.equal(old.status, 426);
  assert.equal(old.body.code, "APP_UPDATE_REQUIRED");
  assert.equal(old.body.data.minSupported, "2.0.0");

  const current = await call("GET", "/api/restaurants/search", { headers: { "X-App-Version": "2.0.0" } });
  assert.equal(current.status, 200);
  const noHeader = await call("GET", "/api/restaurants/search");
  assert.equal(noHeader.status, 200);
  const catalog = await call("GET", "/api/catalog", { headers: { "X-App-Version": "1.0.0" } });
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.data.config.appVersion.latest, "2.1.0");

  const invalid = await call("PUT", "/api/admin/settings", {
    token: state.admin.accessToken,
    body: { appVersion: { minSupported: "3.0.0", latest: "2.0.0" } },
  });
  assert.equal(invalid.status, 400);

  await call("PUT", "/api/admin/settings", {
    token: state.admin.accessToken,
    body: { appVersion: { minSupported: "", latest: "" } },
  });
});

test("permanent restaurant delete removes its followers", async () => {
  const follow = await call("POST", `/api/restaurants/${state.restaurant._id}/follow`, { token: state.user.accessToken });
  assert.equal(follow.status, 200, JSON.stringify(follow.body));
  assert.equal(follow.body.data.followerCount, 1);

  const trash = await call("DELETE", `/api/restaurants/${state.restaurant._id}`, { token: state.admin.accessToken });
  assert.equal(trash.status, 200, JSON.stringify(trash.body));
  const purge = await call("DELETE", `/api/admin/restaurants/${state.restaurant._id}`, { token: state.admin.accessToken });
  assert.equal(purge.status, 200, JSON.stringify(purge.body));
  assert.equal(purge.body.data.summary.followers, 1);

  const ids = await call("GET", "/api/restaurants/following/ids", { token: state.user.accessToken });
  assert.deepEqual(ids.body.data.ids, []);
});

test("logout signs out only this device when the refresh token is sent", async () => {
  const second = await call("POST", "/api/auth/login", { body: { email: USER.email, password: USER.password } });
  assert.equal(second.status, 200);

  const out = await call("POST", "/api/auth/logout", {
    token: state.user.accessToken,
    body: { refreshToken: state.user.refreshToken },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.data.scope, "device");

  // The other device keeps working; this device's refresh token is revoked.
  const other = await call("GET", "/api/auth/me", { token: second.body.data.tokens.accessToken });
  assert.equal(other.status, 200);
  const refresh = await call("POST", "/api/auth/refresh", { token: state.user.refreshToken });
  assert.equal(refresh.status, 401);

  const all = await call("POST", "/api/auth/logout-all", { token: second.body.data.tokens.accessToken });
  assert.equal(all.body.data.scope, "all");
  const after = await call("GET", "/api/auth/me", { token: second.body.data.tokens.accessToken });
  assert.equal(after.status, 401);
});

test("forgot password → 4-digit code → single-use reset token → sign in", async () => {
  const forgot = await call("POST", "/api/auth/forgot-password", { body: { email: USER.email } });
  assert.equal(forgot.status, 200, JSON.stringify(forgot.body));
  assert.equal(forgot.body.data.codeLength, 4);
  const code = await otpFor(USER.email, "reset-password"); // e-mailed in the background

  const verify = await call("POST", "/api/auth/verify-reset-otp", { body: { email: USER.email, code } });
  assert.equal(verify.status, 200, JSON.stringify(verify.body));
  const { resetToken } = verify.body.data;

  const newPassword = "Smoke456!";
  const reset = await call("POST", "/api/auth/reset-password", { token: resetToken, body: { newPassword } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  const reuse = await call("POST", "/api/auth/reset-password", { token: resetToken, body: { newPassword: "Smoke789!" } });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.code, "RESET_TOKEN_INVALID");

  const login = await call("POST", "/api/auth/login", { body: { email: USER.email, password: newPassword } });
  assert.equal(login.status, 200);
});

test("restaurant search: hasMenu with q, hidden menu categories, city id / az address, hours, public fields", async () => {
  const login = await call("POST", "/api/auth/login", { body: ADMIN });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const token = login.body.data.tokens.accessToken;
  const az = { "Accept-Language": "az" };
  const make = async (name, extra = {}) => {
    const res = await call("POST", "/api/restaurants", {
      token,
      body: { name, address: "2 Menu Street", avgPrice: 15, location: { type: "Point", coordinates: [49.86, 40.4] }, ...extra },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.restaurant;
  };
  const withMenu = await make("Qwmenu Alpha", { translations: { az: { name: "Qwmenu Alfa" } } });
  const noMenu = await make("Qwmenu Beta");
  const item = await call("POST", `/api/admin/restaurants/${withMenu._id}/menu/items`, {
    token,
    body: { name: "Qwmenu Soup", price: 5 },
  });
  assert.equal(item.status, 201, JSON.stringify(item.body));

  // hasMenu is kept together with the text query.
  const ids = (res) => res.body.data.restaurants.map((r) => r._id);
  const both = await call("GET", "/api/restaurants/search?q=qwmenu");
  assert.ok(ids(both).includes(withMenu._id) && ids(both).includes(noMenu._id));
  const menuOnly = await call("GET", "/api/restaurants/search?q=qwmenu&hasMenu=true");
  assert.ok(ids(menuOnly).includes(withMenu._id));
  assert.ok(!ids(menuOnly).includes(noMenu._id));

  // Items of a hidden category are left out of every public list.
  const category = await call("POST", `/api/admin/restaurants/${withMenu._id}/menu/categories`, {
    token,
    body: { name: "Secret", isActive: false },
  });
  assert.equal(category.status, 201, JSON.stringify(category.body));
  const hiddenItem = await call("POST", `/api/admin/restaurants/${withMenu._id}/menu/items`, {
    token,
    body: { name: "Qwhidden Stew", price: 7, category: category.body.data.category._id, isPopular: true },
  });
  assert.equal(hiddenItem.status, 201, JSON.stringify(hiddenItem.body));
  const dishes = await call("GET", `/api/restaurants/${withMenu._id}/dishes?q=qwhidden`);
  assert.equal(dishes.status, 200);
  assert.equal(dishes.body.data.dishes.length, 0);
  const byDish = await call("GET", "/api/restaurants/search?dish=qwhidden");
  assert.ok(!ids(byDish).includes(withMenu._id));
  const suggest = await call("GET", "/api/restaurants/suggest?q=qwhidden");
  assert.equal(suggest.body.data.groups.dishes.length, 0);
  const shown = await call("PUT", `/api/admin/menu/categories/${category.body.data.category._id}`, {
    token,
    body: { isActive: true },
  });
  assert.equal(shown.status, 200, JSON.stringify(shown.body));
  const visible = await call("GET", `/api/restaurants/${withMenu._id}/dishes?q=qwhidden`);
  assert.equal(visible.body.data.dishes.length, 1);

  // Menu / dishes headers carry the localized restaurant name.
  const menu = await call("GET", `/api/restaurants/${withMenu._id}/menu`, { headers: az });
  assert.equal(menu.body.data.restaurant.name, "Qwmenu Alfa");
  const dishesAz = await call("GET", `/api/restaurants/${withMenu._id}/dishes`, { headers: az });
  assert.equal(dishesAz.body.data.restaurant.name, "Qwmenu Alfa");

  // City filter by id; the city's az name matches the address.
  const catalog = await call("GET", "/api/catalog");
  const baku = catalog.body.data.cities.find((c) => c.key === withMenu.city);
  assert.ok(baku, "default city in the catalog");
  const byCityId = await call("GET", `/api/restaurants/search?q=qwmenu&city=${baku._id}`);
  assert.ok(ids(byCityId).includes(withMenu._id));
  if (baku.translations?.az?.name) {
    const byAzCity = await call("GET", `/api/restaurants/search?q=${encodeURIComponent(`qwmenu ${baku.translations.az.name}`)}`);
    assert.ok(ids(byAzCity).includes(withMenu._id));
  }

  // No hours configured → unknown: never "Open now", not in the openNow filter.
  const detail = await call("GET", `/api/restaurants/${noMenu._id}`, { headers: az });
  assert.equal(detail.body.data.restaurant.openNow, false);
  assert.equal(detail.body.data.restaurant.openStatus.state, "noHours");
  assert.equal(detail.body.data.restaurant.openStatus.label, "İş saatları məlum deyil");
  const openNow = await call("GET", "/api/restaurants/search?q=qwmenu&openNow=true");
  assert.ok(!ids(openNow).includes(noMenu._id));

  // Public payloads leave out admin bookkeeping; admin writes keep it.
  assert.equal(detail.body.data.restaurant.createdBy, undefined);
  assert.equal(detail.body.data.restaurant.isDeleted, undefined);
  assert.ok(withMenu.createdBy, "admin response keeps createdBy");
});

// ------------------------------------------------ auth hardening (sign-up / OTP / sessions)
const TAKEOVER = { email: `takeover.${Date.now()}@smoke.test`, firstName: "Owner", lastName: "Inbox" };
const wrongCode = (code, k) => String((Number(code) + k) % 10000).padStart(4, "0");

test("sign-up: a second /register can't swap the payload of a pending code", async () => {
  const first = await call("POST", "/api/auth/register", {
    body: { ...TAKEOVER, password: "Owner123!", acceptTerms: true },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(first.body.data.registrationId, /^[a-f0-9]{32}$/);
  const code = await otpFor(TAKEOVER.email, "register");
  const sends = otpCount(TAKEOVER.email);

  // Someone else re-registers the same address with their own password.
  const attack = await call("POST", "/api/auth/register", {
    body: { ...TAKEOVER, firstName: "Attacker", password: "Attack123!", acceptTerms: true },
  });
  assert.equal(attack.status, 429, JSON.stringify(attack.body));
  assert.equal(attack.body.code, "OTP_COOLDOWN");
  assert.ok(attack.body.retryAfter > 0);

  // The owner (same password) may still fix a typo; the code e-mailed stays the same.
  const fix = await call("POST", "/api/auth/register", {
    body: { ...TAKEOVER, firstName: "Owner Fixed", password: "Owner123!", acceptTerms: true },
  });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  assert.equal(fix.body.data.registrationId, first.body.data.registrationId);
  assert.equal(otpCount(TAKEOVER.email), sends, "no new code inside the cooldown");

  // A client holding another sign-up's id can't complete this one.
  const foreign = await call("POST", "/api/auth/verify-otp", {
    body: { email: TAKEOVER.email, code, registrationId: "f".repeat(32) },
  });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.code, "OTP_NOT_FOUND");

  const verify = await call("POST", "/api/auth/verify-otp", {
    body: { email: TAKEOVER.email, code, registrationId: first.body.data.registrationId },
  });
  assert.equal(verify.status, 201, JSON.stringify(verify.body));
  assert.equal(verify.body.data.user.firstName, "Owner Fixed");
  TAKEOVER.id = verify.body.data.user.id;
  TAKEOVER.password = "Owner123!";

  const attacker = await call("POST", "/api/auth/login", { body: { email: TAKEOVER.email, password: "Attack123!" } });
  assert.equal(attacker.status, 401);
  const owner = await call("POST", "/api/auth/login", { body: { email: TAKEOVER.email, password: "Owner123!" } });
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
});

test("forgot password answers the same for any address; code guesses are capped atomically", async () => {
  const config = await call("GET", "/api/auth/config");
  assert.equal(config.body.data.otp.maxAttempts, 3);

  const unknown = await call("POST", "/api/auth/forgot-password", { body: { email: "nobody.at.all@smoke.test" } });
  const sent = otpCount(USER.email);
  const known = await call("POST", "/api/auth/forgot-password", { body: { email: USER.email } });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.deepEqual({ ...known.body, data: { ...known.body.data, email: "" } }, {
    ...unknown.body,
    data: { ...unknown.body.data, email: "" },
  });
  const again = await call("POST", "/api/auth/forgot-password", { body: { email: USER.email } });
  assert.equal(again.status, 200, "cooldown is not revealed");
  assert.equal(again.body.message, unknown.body.message);

  // (USER: the per-address OTP limiter allows 10 calls / 15 min — this test uses the last 6.)
  for (let i = 0; i < 50 && otpCount(USER.email) === sent; i += 1) await sleep(100); // sent in the background
  const code = await otpFor(USER.email, "reset-password");
  // Parallel wrong guesses: never more than MAX_ATTEMPTS get compared.
  const guesses = await Promise.all(
    [1, 2, 3, 4].map((k) =>
      call("POST", "/api/auth/verify-reset-otp", { body: { email: USER.email, code: wrongCode(code, k) } }),
    ),
  );
  const codes = guesses.map((g) => g.body.code);
  assert.equal(codes.filter((c) => c === "OTP_INVALID").length, 3, codes.join(","));
  assert.equal(codes.filter((c) => c === "OTP_TOO_MANY_ATTEMPTS").length, 1, codes.join(","));
});

test("password change signs out the other devices and drops their push tokens", async () => {
  const signIn = async () =>
    (await call("POST", "/api/auth/login", { body: { email: TAKEOVER.email, password: TAKEOVER.password } })).body.data
      .tokens;
  const [one, two] = [await signIn(), await signIn()];
  for (const [tokens, push] of [
    [one, "ExponentPushToken[smoke-one]"],
    [two, "ExponentPushToken[smoke-two]"],
  ]) {
    const res = await call("POST", "/api/users/me/push-token", { token: tokens.accessToken, body: { token: push } });
    assert.ok(res.status < 300, JSON.stringify(res.body));
  }

  const changed = await call("PUT", "/api/auth/change-password", {
    token: one.accessToken,
    body: { currentPassword: TAKEOVER.password, newPassword: "Owner456!", pushToken: "ExponentPushToken[smoke-one]" },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  TAKEOVER.password = "Owner456!";

  const other = await call("GET", "/api/auth/me", { token: two.accessToken });
  assert.equal(other.status, 401);
  const self = await call("GET", "/api/auth/me", { token: changed.body.data.tokens.accessToken });
  assert.equal(self.status, 200);

  const admin = (await call("POST", "/api/auth/login", { body: ADMIN })).body.data.tokens;
  const sessions = await call("GET", `/api/admin/users/${TAKEOVER.id}/sessions`, { token: admin.accessToken });
  assert.equal(sessions.status, 200, JSON.stringify(sessions.body));
  assert.equal(sessions.body.data.pushDevices, 1);
  assert.equal(sessions.body.data.activeSessions, 1);
  TAKEOVER.adminToken = admin.accessToken;
});

test("login lockout also covers suspended accounts (status gate behind the limiter)", async () => {
  const suspend = await call("POST", `/api/admin/users/${TAKEOVER.id}/suspend`, {
    token: TAKEOVER.adminToken,
    body: { reason: "Smoke test", days: 1 },
  });
  assert.equal(suspend.status, 200, JSON.stringify(suspend.body));

  const right = await call("POST", "/api/auth/login", { body: { email: TAKEOVER.email, password: TAKEOVER.password } });
  assert.equal(right.status, 403);
  assert.equal(right.body.code, "ACCOUNT_SUSPENDED");

  for (let i = 0; i < 10; i += 1) {
    await call("POST", "/api/auth/login", { body: { email: TAKEOVER.email, password: `Wrong${i}abc!` } });
  }
  const locked = await call("POST", "/api/auth/login", { body: { email: TAKEOVER.email, password: TAKEOVER.password } });
  assert.equal(locked.status, 429, JSON.stringify(locked.body));
  assert.equal(locked.body.code, "LOGIN_LOCKED");
});

// ------------------------------------------------ reviews: moderation, visibility, reports, notifications
test("reviews: moderation can't be bypassed, hidden restaurants, reports, tags, localized dishes", async () => {
  const admin = (await call("POST", "/api/auth/login", { body: ADMIN })).body.data.tokens.accessToken;
  const setAutoApprove = async (value) => {
    const res = await call("PUT", "/api/admin/settings", { token: admin, body: { autoApproveReviews: value } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };
  const member = async (name) => {
    const person = { email: `${name.toLowerCase()}.${Date.now()}@smoke.test`, password: "Review123!", firstName: name, lastName: "Smoke" };
    const reg = await call("POST", "/api/auth/register", { body: { ...person, acceptTerms: true } });
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    const code = await otpFor(person.email, "register");
    const verify = await call("POST", "/api/auth/verify-otp", {
      body: { email: person.email, code, registrationId: reg.body.data.registrationId },
    });
    assert.equal(verify.status, 201, JSON.stringify(verify.body));
    return { id: String(verify.body.data.user._id ?? verify.body.data.user.id), token: verify.body.data.tokens.accessToken };
  };

  const place = await call("POST", "/api/restaurants", {
    token: admin,
    body: { name: "Qwreview Place", address: "3 Review Street", avgPrice: 12, location: { type: "Point", coordinates: [49.85, 40.41] } },
  });
  assert.equal(place.status, 201, JSON.stringify(place.body));
  const restaurant = place.body.data.restaurant._id;
  const dish = await call("POST", `/api/admin/restaurants/${restaurant}/menu/items`, {
    token: admin,
    body: { name: "Qwplov", price: 9, translations: { az: { name: "Qwplov AZ" } } },
  });
  assert.equal(dish.status, 201, JSON.stringify(dish.body));
  const dishId = dish.body.data.item?._id ?? dish.body.data.menuItem?._id;

  const [author, reader] = [await member("Author"), await member("Reader")];
  await setAutoApprove(true);
  try {
    // Tagging someone unrelated is dropped; the app sends the dish name in its language.
    const created = await call("POST", "/api/reviews", {
      token: author.token,
      body: { restaurant, sentiment: "liked", comment: "Great", companions: [reader.id], favoriteDishes: [{ name: "Qwplov AZ" }] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const review = created.body.data.review;
    assert.equal(review.status, "approved");
    assert.deepEqual(review.companions, []);
    assert.equal(review.favoriteDishes[0].name, "Qwplov");
    assert.equal(String(review.favoriteDishes[0].menuItem), String(dishId));
    // Rating is derived in one server-side aggregation ($merge).
    const rated = await call("GET", `/api/restaurants/${place.body.data.restaurant.slug}`);
    assert.equal(rated.body.data.restaurant.rating, 5);
    assert.equal(rated.body.data.restaurant.reviewCount, 1);
    const inAz = await call("GET", `/api/reviews/${review._id}`, { token: reader.token, headers: { "Accept-Language": "az" } });
    assert.equal(inAz.body.data.review.favoriteDishes[0].name, "Qwplov AZ");
    const photos = await call("GET", `/api/reviews/photos?restaurant=${restaurant}&dish=Qwplov%20AZ`, { token: reader.token });
    assert.equal(photos.status, 200, JSON.stringify(photos.body));

    // Followers can be tagged — notified once, with its own type.
    const follow = await call("POST", `/api/users/${author.id}/follow`, { token: reader.token });
    assert.ok(follow.status < 300, JSON.stringify(follow.body));
    for (const comment of ["Tagged", "Tagged again"]) {
      const tagged = await call("PUT", `/api/reviews/${review._id}`, { token: author.token, body: { comment, companions: [reader.id] } });
      assert.equal(tagged.status, 200, JSON.stringify(tagged.body));
    }
    let tags = [];
    for (let i = 0; i < 20 && !tags.length; i += 1) {
      const inbox = await call("GET", "/api/notifications", { token: reader.token });
      tags = inbox.body.data.notifications.filter((n) => n.type === "review_tag");
      if (!tags.length) await sleep(100);
    }
    assert.equal(tags.length, 1);
    assert.deepEqual(tags[0].actions, ["view_review"]);

    // Objects are not text.
    const objComment = await call("POST", `/api/reviews/${review._id}/comments`, { token: reader.token, body: { text: { a: 1 } } });
    assert.equal(objComment.status, 400);
    const objShare = await call("POST", `/api/reviews/${review._id}/share`, { token: reader.token, body: { channel: "link", message: { a: 1 } } });
    assert.equal(objShare.status, 400);

    // A double tap files one report.
    const catalog = await call("GET", "/api/catalog");
    const reason = catalog.body.data.reportReasons?.[0]?.key ?? catalog.body.data.reportReasons?.[0]?.name ?? "Spam / advertising";
    const reports = await Promise.all(
      [1, 2].map(() =>
        call("POST", "/api/reports", { token: reader.token, body: { targetType: "review", targetId: review._id, reason } }),
      ),
    );
    assert.deepEqual(reports.map((r) => r.status).sort(), [201, 409], JSON.stringify(reports.map((r) => r.body)));

    // Rejected stays rejected after the author edits it; the same status twice is a no-op.
    const reject = await call("PATCH", `/api/admin/reviews/${review._id}`, { token: admin, body: { status: "rejected", reason: "Spam" } });
    assert.equal(reject.status, 200, JSON.stringify(reject.body));
    const again = await call("PATCH", `/api/admin/reviews/${review._id}`, { token: admin, body: { status: "rejected" } });
    assert.match(again.body.message, /already/);
    const edited = await call("PUT", `/api/reviews/${review._id}`, { token: author.token, body: { comment: "Edited after reject" } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.data.review.status, "rejected");
    // One NEW review per place per 24 h; after that a second review is allowed,
    // but it can't bypass the rejected one: it waits as pending.
    const tooSoon = await call("POST", "/api/reviews", {
      token: author.token,
      body: { restaurant, sentiment: "liked", comment: "Again" },
      headers: { "Accept-Language": "az" },
    });
    assert.equal(tooSoon.status, 429, JSON.stringify(tooSoon.body));
    assert.equal(tooSoon.body.code, "REVIEW_TOO_SOON");
    assert.ok(tooSoon.body.retryAfter > 0 && tooSoon.body.retryAfter <= 24 * 3600);
    assert.match(tooSoon.body.message, /saat/);
    const ageReviews = async () => {
      const conn = await mongoose.createConnection(MONGODB_URI).asPromise();
      await conn.collection("reviews").updateMany(
        { restaurant: new mongoose.Types.ObjectId(restaurant) },
        { $set: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } },
      );
      await conn.close();
    };
    await ageReviews();
    const repost = await call("POST", "/api/reviews", { token: author.token, body: { restaurant, sentiment: "liked", comment: "Again" } });
    assert.equal(repost.status, 201, JSON.stringify(repost.body));
    assert.notEqual(repost.body.data.review._id, review._id);
    assert.equal(repost.body.data.review.status, "pending");
    await ageReviews();

    // Other people's non-public reviews can't be reported.
    const hiddenReport = await call("POST", "/api/reports", { token: reader.token, body: { targetType: "review", targetId: review._id, reason } });
    assert.equal(hiddenReport.status, 404);

    // After an admin removal, a new review of the same place waits for moderation.
    const removed = await call("DELETE", `/api/admin/reviews/${review._id}`, { token: admin, body: { reason: "Removed" } });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const fresh = await call("POST", "/api/reviews", { token: author.token, body: { restaurant, sentiment: "liked", comment: "New one" } });
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
    assert.equal(fresh.body.data.review.status, "pending");

    // Reviews of a hidden restaurant are not public and can't be written.
    const suspend = await call("PATCH", `/api/admin/restaurants/${restaurant}/status`, {
      token: admin,
      body: { status: "suspended", reason: "Smoke" },
    });
    assert.equal(suspend.status, 200, JSON.stringify(suspend.body));
    const list = await call("GET", `/api/reviews?restaurant=${restaurant}`, { token: reader.token });
    assert.equal(list.status, 404);
    const write = await call("POST", "/api/reviews", { token: reader.token, body: { restaurant, sentiment: "fine" } });
    assert.equal(write.status, 404);
  } finally {
    await setAutoApprove(false);
  }
});

// ------------------------------------------------ people: follow requests, lists, account cleanup
// Accounts are inserted straight into the throwaway DB (no OTP budget used) and signed in through the API.
const people = {};
const dbConn = async () => {
  // (Re)opened on demand — a test may have closed it.
  if (people.conn?.readyState !== 1) people.conn = await mongoose.createConnection(MONGODB_URI).asPromise();
  return people.conn;
};
const makePerson = async (key, firstName) => {
  const { default: bcrypt } = await import("bcryptjs");
  const email = `${key}.${Date.now()}@smoke.test`;
  const password = "People123!";
  const conn = await dbConn();
  const now = new Date();
  const { insertedId } = await conn.collection("users").insertOne({
    firstName,
    lastName: "Smoke",
    email,
    password: await bcrypt.hash(password, 4),
    role: "user",
    status: "active",
    isDeleted: false,
    isPrivate: false,
    following: [],
    dismissedSuggestions: [],
    pushTokens: [],
    tokenVersion: 0,
    settings: { reviewsVisibility: "everyone", listsVisibility: "everyone" },
    createdAt: now,
    updatedAt: now,
  });
  const login = await call("POST", "/api/auth/login", { body: { email, password } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  people[key] = { id: String(insertedId), email, password, token: login.body.data.tokens.accessToken };
  return people[key];
};

test("follow requests: private accounts get requests; accept / decline / cancel; going public accepts", async () => {
  const a = await makePerson("asker", "Asker");
  const b = await makePerson("private", "Priva");
  const setPrivate = (isPrivate) => call("PUT", "/api/users/me/settings", { token: b.token, body: { isPrivate } });
  assert.equal((await setPrivate(true)).status, 200);

  const req1 = await call("POST", `/api/users/${b.id}/follow`, { token: a.token });
  assert.equal(req1.status, 200, JSON.stringify(req1.body));
  assert.equal(req1.body.data.followStatus, "requested");
  assert.equal(req1.body.data.following, false);
  const again = await call("POST", `/api/users/${b.id}/follow`, { token: a.token });
  assert.equal(again.body.data.followStatus, "requested");

  const seen = await call("GET", `/api/users/${b.id}`, { token: a.token });
  assert.equal(seen.body.data.followStatus, "requested");
  assert.equal(seen.body.data.isFollowing, false);
  assert.equal(seen.body.data.privacy.canViewLists, false);
  assert.equal(seen.body.data.stats.lists, 0);
  const search = await call("GET", "/api/users/search?q=Priva", { token: a.token });
  assert.equal(search.body.data.users.find((u) => u._id === b.id)?.followStatus, "requested");

  const me = await call("GET", "/api/users/me", { token: b.token });
  assert.equal(me.body.data.followRequestCount, 1);
  const requests = await call("GET", "/api/users/me/follow-requests", { token: b.token });
  assert.equal(requests.status, 200);
  assert.equal(requests.body.data.pagination.total, 1);
  assert.equal(requests.body.data.requests[0].user._id, a.id);
  assert.equal(requests.body.data.requests[0].user.followStatus, "none");
  const notes = async (token, type) =>
    (await call("GET", "/api/notifications", { token })).body.data.notifications.filter((n) => n.type === type);
  const [pending] = await notes(b.token, "follow_request");
  assert.deepEqual(pending.actions, ["accept_follow", "decline_follow"]);
  assert.equal(pending.message, "requested to follow you.");

  // Cancel → request and notification are gone.
  const cancel = await call("DELETE", `/api/users/${b.id}/follow`, { token: a.token });
  assert.equal(cancel.body.data.followStatus, "none");
  assert.equal((await call("GET", "/api/users/me", { token: b.token })).body.data.followRequestCount, 0);
  assert.equal((await notes(b.token, "follow_request")).length, 0);

  // Request → accept: a follows b, a is told, b's notice turns into a follower notice.
  await call("POST", `/api/users/${b.id}/follow`, { token: a.token });
  const accept = await call("POST", `/api/users/me/follow-requests/${a.id}/accept`, { token: b.token });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  assert.equal(accept.body.data.followerCount, 1);
  const missing = await call("POST", `/api/users/me/follow-requests/${a.id}/accept`, { token: b.token });
  assert.equal(missing.body.code, "FOLLOW_REQUEST_NOT_FOUND");
  const now = await call("GET", `/api/users/${b.id}`, { token: a.token });
  assert.equal(now.body.data.followStatus, "following");
  assert.equal(now.body.data.privacy.canViewLists, true);
  const [accepted] = await notes(a.token, "follow_accept");
  assert.equal(accepted.message, "accepted your follow request.");
  const [updated] = await notes(b.token, "follow_request");
  assert.ok(updated.actions.includes("view_profile") && !updated.actions.includes("accept_follow"));
  const az = await call("GET", "/api/notifications", { token: a.token, headers: { "Accept-Language": "az" } });
  assert.equal(az.body.data.notifications.find((n) => n.type === "follow_accept").message, "izləmə istəyinizi qəbul etdi.");

  // Decline: silent, the requester is back to "none".
  await call("DELETE", `/api/users/${b.id}/follow`, { token: a.token });
  await call("POST", `/api/users/${b.id}/follow`, { token: a.token });
  const decline = await call("POST", `/api/users/me/follow-requests/${a.id}/decline`, { token: b.token });
  assert.equal(decline.body.data.declined, true);
  assert.equal((await call("GET", `/api/users/${b.id}`, { token: a.token })).body.data.followStatus, "none");

  // Going public accepts pending requests.
  await call("POST", `/api/users/${b.id}/follow`, { token: a.token });
  assert.equal((await setPrivate(false)).status, 200);
  const open = await call("GET", `/api/users/${b.id}`, { token: a.token });
  assert.equal(open.body.data.followStatus, "following");
  assert.equal(open.body.data.stats.followers, 1);
});

test("lists: share link only for members, Saved list locked, live itemCount, saveCount from writes", async () => {
  const owner = people.private;
  const viewer = people.asker;
  const created = await call("POST", "/api/restaurants", {
    token: state.admin.accessToken,
    body: {
      name: "Smoke Lists Cafe",
      description: "Restaurant for the list checks.",
      address: "2 Test Street",
      avgPrice: 15,
      location: { type: "Point", coordinates: [49.8671, 40.4093] },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const restaurant = created.body.data.restaurant;
  const saveCount = async () => (await call("GET", `/api/restaurants/${restaurant.slug}`)).body.data.restaurant.saveCount;

  const collab = await call("POST", "/api/favorites", {
    token: owner.token,
    body: { name: "Team picks", privacy: "collaborative" },
  });
  assert.equal(collab.status, 201, JSON.stringify(collab.body));
  const listId = collab.body.data.list._id;
  assert.ok(collab.body.data.list.shareSlug, "the owner gets the invite link");
  const strangerView = await call("GET", `/api/favorites/${listId}`, { token: viewer.token });
  assert.equal(strangerView.status, 200, JSON.stringify(strangerView.body));
  assert.equal(strangerView.body.data.list.shareSlug, null);
  assert.equal(strangerView.body.data.list.shareUrl, null);
  const profileLists = await call("GET", `/api/users/${owner.id}/lists`, { token: viewer.token });
  assert.equal(profileLists.body.data.lists.find((l) => l._id === listId).shareSlug, null);

  // Add twice (double tap) → one save; the heart on the same restaurant → still one owner.
  const add = await call("POST", `/api/favorites/${listId}/items`, { token: owner.token, body: { restaurant: restaurant._id } });
  assert.equal(add.body.data.added, true);
  assert.equal(add.body.data.itemCount, 1);
  const twice = await call("POST", `/api/favorites/${listId}/items`, { token: owner.token, body: { restaurant: restaurant._id } });
  assert.equal(twice.body.data.added, false);
  assert.equal(await saveCount(), 1);
  await call("POST", "/api/favorites/toggle", { token: owner.token, body: { restaurant: restaurant._id } });
  assert.equal(await saveCount(), 1);
  const removed = await call("DELETE", `/api/favorites/${listId}/items/${restaurant._id}`, { token: owner.token });
  assert.equal(removed.body.data.itemCount, 0);
  assert.equal(await saveCount(), 1, "still in the Saved list");
  await call("POST", "/api/favorites/toggle", { token: owner.token, body: { restaurant: restaurant._id } });
  assert.equal(await saveCount(), 0);

  // The default "Saved" list: rename yes, delete / collaborative no.
  const mine = await call("GET", "/api/favorites", { token: owner.token });
  const savedId = mine.body.data.defaultListId;
  const del = await call("DELETE", `/api/favorites/${savedId}`, { token: owner.token });
  assert.equal(del.status, 400);
  assert.equal(del.body.code, "LIST_DEFAULT_LOCKED");
  const collabSaved = await call("PUT", `/api/favorites/${savedId}`, { token: owner.token, body: { privacy: "collaborative" } });
  assert.equal(collabSaved.body.code, "LIST_DEFAULT_LOCKED");
  const rename = await call("PUT", `/api/favorites/${savedId}`, { token: owner.token, body: { name: "My saves" } });
  assert.equal(rename.status, 200, JSON.stringify(rename.body));

  // Followers-only lists: a non-follower can't open them by id.
  await call("DELETE", `/api/users/${owner.id}/follow`, { token: viewer.token });
  await call("PUT", "/api/users/me/settings", { token: owner.token, body: { settings: { listsVisibility: "followers" } } });
  const hidden = await call("GET", `/api/favorites/${listId}`, { token: viewer.token });
  assert.equal(hidden.status, 403);
  assert.equal(hidden.body.code, "LIST_PRIVATE");
  const follow = await call("POST", `/api/favorites/${listId}/follow`, { token: viewer.token });
  assert.equal(follow.status, 403);
  // …but the invite link (only members get it) still works.
  const link = await call("GET", `/api/favorites/share/${collab.body.data.list.shareSlug}`, { token: viewer.token });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  assert.equal(link.body.data.canJoin, true);
  const expired = await call("GET", `/api/favorites/share/${collab.body.data.list.shareSlug}`, { token: "not.a.token" });
  assert.equal(expired.status, 200, "a bad (not expired) token is a guest");
});

test("invite text in the request language; push tokens move between accounts; delete cleans up", async () => {
  const a = people.asker;
  const b = people.private;
  const invite = await call("GET", "/api/users/me/invite", { token: a.token, headers: { "Accept-Language": "az" } });
  assert.match(invite.body.data.message, /^Asker sizi Yumio-ya dəvət edir/);

  const token = "ExponentPushToken[shared-device]";
  await call("POST", "/api/users/me/push-token", { token: a.token, body: { token } });
  await call("POST", "/api/users/me/push-token", { token: b.token, body: { token } });
  const conn = await dbConn();
  const users = conn.collection("users");
  const ids = [a.id, b.id].map((id) => new mongoose.Types.ObjectId(id));
  const [ua, ub] = await Promise.all(ids.map((_id) => users.findOne({ _id })));
  assert.deepEqual(ua.pushTokens, []);
  assert.deepEqual(ub.pushTokens, [token]);

  // b (private again) has a pending request from a; deleting b removes it.
  await call("PUT", "/api/users/me/settings", { token: b.token, body: { isPrivate: true } });
  await call("DELETE", `/api/users/${b.id}/follow`, { token: a.token });
  assert.equal((await call("POST", `/api/users/${b.id}/follow`, { token: a.token })).body.data.followStatus, "requested");
  await conn.collection("searchhistories").insertOne({ user: ids[1], type: "query", label: "pizza", query: "pizza", key: "query:pizza", createdAt: new Date(), updatedAt: new Date() });
  const gone = await call("DELETE", "/api/users/me", { token: b.token, body: { password: b.password } });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(gone.body.data.summary.followRequests, 1);
  assert.equal(gone.body.data.summary.searchHistory, 1);
  assert.equal(await conn.collection("followrequests").countDocuments({ $or: [{ requester: ids[1] }, { target: ids[1] }] }), 0);
  await people.conn.close();
});

test("AI translation: disabled without OPENROUTER_API_KEY (status + 503), admin only", async () => {
  const admin = (await call("POST", "/api/auth/login", { body: ADMIN })).body.data.tokens.accessToken;
  const status = await call("GET", "/api/admin/translate/status", { token: admin });
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.data.enabled, false);
  assert.equal(typeof status.body.data.model, "string");

  const body = { from: "en", to: ["az", "ru"], texts: { name: "Pizza", "sections.2.body": ["Up to {maxDiscount}% off", ""] } };
  const off = await call("POST", "/api/admin/translate", { token: admin, body, headers: { "Accept-Language": "az" } });
  assert.equal(off.status, 503);
  assert.equal(off.body.code, "TRANSLATE_NOT_CONFIGURED");
  assert.equal(off.body.message, "Süni intellektlə tərcümə serverdə qurulmayıb");

  const user = await call("POST", "/api/admin/translate", { token: people.asker.token, body });
  assert.equal(user.status, 403);
});

test("in-app sending of lists / restaurants to users is disabled", async () => {
  const res = await call("POST", "/api/users/me/share", {
    token: people.asker.token,
    body: { userIds: [people.asker.id], restaurant: state.restaurant._id },
    headers: { "Accept-Language": "ru" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "SHARE_DISABLED");
  assert.match(res.body.message, /Поделитесь ссылкой/);
});

test("privacy page: data & rights section cut down to the 'we do not sell' statement (en / az / ru)", async () => {
  const last = async (lang) => {
    const res = await call("GET", "/api/content/pages/privacy", { headers: lang ? { "Accept-Language": lang } : {} });
    assert.equal(res.status, 200);
    return res.body.data.page.sections.at(-1);
  };
  const en = await last();
  assert.equal(en.heading, "Your Data");
  assert.equal(en.body, "We do not sell your personal data to third parties.");
  assert.equal((await last("az")).body, "Şəxsi məlumatlarınızı üçüncü tərəflərə satmırıq.");
  assert.equal((await last("ru")).body, "Мы не продаём ваши персональные данные третьим лицам.");
});

test("bulk restaurant import: template, dryRun errors, create with menu (searchable), upsert, create-only skip", async () => {
  const token = (await call("POST", "/api/auth/login", { body: ADMIN })).body.data.tokens.accessToken;

  const template = await call("GET", "/api/admin/restaurants/import/template", { token });
  assert.equal(template.status, 200, JSON.stringify(template.body));
  assert.equal(template.body.data.restaurants.length, 2);
  assert.ok(template.body.data.fields.menu);
  const templateCheck = await call("POST", "/api/admin/restaurants/import", { token, body: template.body.data });
  assert.equal(templateCheck.body.data.summary.failed, 0, JSON.stringify(templateCheck.body.data.rows));
  assert.equal(templateCheck.body.data.dryRun, true);

  const stamp = Date.now().toString(36);
  const rows = [
    {
      name: `Import Fish ${stamp}`,
      cuisines: ["Seafood", "Azərbaycan"],
      city: "Bakı",
      address: "1 Import Street",
      location: { lat: 40.37, lng: 49.84 },
      avgPrice: 30,
      hours: { mon: { open: "09:00", close: "23:00" } },
      coverImages: ["https://example.com/a.jpg"],
      translations: { az: { name: `İdxal Balıq ${stamp}` } },
      menu: [
        {
          name: "Grill",
          items: [
            { name: `Sturgeon ${stamp}`, price: 30, isPopular: true, dietary: ["Halal"] },
            { name: "Kutum", price: 20 },
          ],
        },
      ],
    },
    { name: `Import Cafe ${stamp}`, cuisines: ["Cafe"], location: { type: "Point", coordinates: [49.85, 40.38] } },
  ];

  // dryRun: unknown cuisine → error row (strict), nothing written.
  const dry = await call("POST", "/api/admin/restaurants/import", {
    token,
    body: { dryRun: true, restaurants: [...rows, { name: `Bad ${stamp}`, cuisines: ["Martian"] }] },
  });
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.deepEqual(dry.body.data.summary, { total: 3, created: 2, updated: 0, skipped: 0, failed: 1 });
  assert.equal(dry.body.data.rows[2].action, "error");
  assert.match(dry.body.data.rows[2].errors.join(" "), /Unknown cuisines: Martian/);
  const none = await call("GET", `/api/restaurants/search?q=${encodeURIComponent(`import fish ${stamp}`)}`);
  assert.equal(none.body.data.restaurants.length, 0, "dryRun writes nothing");

  // strict: false → the unknown name is dropped with a warning.
  const loose = await call("POST", "/api/admin/restaurants/import", {
    token,
    body: { dryRun: true, strict: false, restaurants: [{ name: `Bad ${stamp}`, cuisines: ["Martian", "Cafe"] }] },
  });
  assert.equal(loose.body.data.rows[0].action, "create");
  assert.match(loose.body.data.rows[0].warnings.join(" "), /Martian/);

  const bad = await call("POST", "/api/admin/restaurants/import", { token, body: { restaurants: [] } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "IMPORT_INVALID");

  // Real import: 2 restaurants, menu, searchable (incl. the az name), menu derived fields.
  const run = await call("POST", "/api/admin/restaurants/import", { token, body: { restaurants: rows } });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.deepEqual(run.body.data.summary, { total: 2, created: 2, updated: 0, skipped: 0, failed: 0 });
  const [fishRow] = run.body.data.rows;
  assert.ok(fishRow.id);

  const found = await call("GET", `/api/restaurants/search?q=${encodeURIComponent(`import fish ${stamp}`)}`);
  const fish = found.body.data.restaurants.find((r) => r._id === fishRow.id);
  assert.ok(fish, "imported restaurant is searchable");
  assert.equal(fish.city, "Baku");
  assert.deepEqual(fish.cuisines.map((c) => (typeof c === "string" ? c : c.key || c.name)).sort(), ["Azerbaijani", "Seafood"]);
  const byAz = await call("GET", `/api/restaurants/search?q=${encodeURIComponent(`idxal balıq ${stamp}`)}`);
  assert.ok(byAz.body.data.restaurants.some((r) => r._id === fishRow.id), "found by its az name");
  const cafe = await call("GET", `/api/restaurants/search?q=${encodeURIComponent(`import cafe ${stamp}`)}`);
  assert.equal(cafe.body.data.restaurants.length, 1);

  const menu = await call("GET", `/api/restaurants/${fishRow.id}/menu`);
  assert.equal(menu.status, 200);
  assert.equal(menu.body.data.itemCount, 2);
  assert.equal(menu.body.data.popular[0].name, `Sturgeon ${stamp}`);
  const dish = await call("GET", `/api/restaurants/search?dish=${encodeURIComponent(`Sturgeon ${stamp}`)}`);
  assert.ok(dish.body.data.restaurants.some((r) => r._id === fishRow.id), "dish search finds the imported menu");

  // Upsert by name + city: updates, replaces the menu only when given.
  const upsert = await call("POST", "/api/admin/restaurants/import", {
    token,
    body: {
      restaurants: [
        { name: rows[0].name.toLowerCase(), city: "Baku", avgPrice: 40, menu: [{ name: "Soups", items: [{ name: "Dushbara", price: 8 }] }] },
        { name: rows[1].name, phone: "+994 50 000 00 00" },
      ],
    },
  });
  assert.equal(upsert.status, 200, JSON.stringify(upsert.body));
  assert.deepEqual(upsert.body.data.summary, { total: 2, created: 0, updated: 2, skipped: 0, failed: 0 });
  assert.equal(upsert.body.data.rows[0].id, fishRow.id);
  assert.match(upsert.body.data.rows[0].warnings.join(" "), /menu will be replaced/);
  const replaced = await call("GET", `/api/restaurants/${fishRow.id}/menu`);
  assert.equal(replaced.body.data.itemCount, 1);
  assert.equal(replaced.body.data.categories[0].name, "Soups");

  const createOnly = await call("POST", "/api/admin/restaurants/import", {
    token,
    body: { mode: "create", restaurants: [{ name: rows[1].name }] },
  });
  assert.equal(createOnly.body.data.rows[0].action, "skip");
  assert.equal(createOnly.body.data.summary.skipped, 1);
});

// ------------------------------------------------ reviews: several per place, liked %, sharing
test("reviews: several per place (24 h cooldown), myReviews, liked % stats + best-rated sort, share counter only", async () => {
  const admin = (await call("POST", "/api/auth/login", { body: ADMIN })).body.data.tokens.accessToken;
  const settings = (body) => call("PUT", "/api/admin/settings", { token: admin, body });
  const make = async (name) => {
    const res = await call("POST", "/api/restaurants", {
      token: admin,
      body: { name, address: "5 Liked Street", avgPrice: 18, location: { type: "Point", coordinates: [49.84, 40.38] } },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.restaurant;
  };
  const [half, full] = [await make("Qwliked Half"), await make("Qwliked Full")];
  // makePerson (re)opens the shared DB connection; close it whatever happens.
  const closeConn = () => people.conn?.close();
  let author;
  let reader;
  try {
    [author, reader] = [await makePerson("multiauthor", "Multi"), await makePerson("multireader", "Reader")];
  } catch (error) {
    await closeConn();
    throw error;
  }
  const age = async (restaurantId) => {
    const conn = await dbConn();
    await conn.collection("reviews").updateMany(
      { restaurant: new mongoose.Types.ObjectId(restaurantId) },
      { $set: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } },
    );
  };
  try {
    assert.equal((await settings({ autoApproveReviews: true })).status, 200);
    const first = await call("POST", "/api/reviews", { token: author.token, body: { restaurant: half._id, sentiment: "liked" } });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const blocked = await call("POST", "/api/reviews", { token: author.token, body: { restaurant: half._id, sentiment: "fine" } });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, "REVIEW_TOO_SOON");
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    // Edits are not limited.
    const edit = await call("PUT", `/api/reviews/${first.body.data.review._id}`, { token: author.token, body: { comment: "Edited" } });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));

    await age(half._id);
    const second = await call("POST", "/api/reviews", { token: author.token, body: { restaurant: half._id, sentiment: "fine" } });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.data.review.status, "approved");

    // Both reviews count; the author sees all of theirs, newest first.
    const list = await call("GET", `/api/reviews?restaurant=${half._id}`, { token: author.token });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(
      list.body.data.myReviews.map((r) => r._id),
      [second.body.data.review._id, first.body.data.review._id],
    );
    assert.equal(list.body.data.myReview._id, second.body.data.review._id);
    assert.equal(list.body.data.reviews.length, 2);
    assert.equal(list.body.data.summary.likedPercent, 50);
    const stats = { total: 2, liked: 1, fine: 1, disliked: 0, likedPercent: 50 };
    assert.deepEqual(list.body.data.summary.reviewStats, stats);
    const readerList = await call("GET", `/api/reviews?restaurant=${half._id}`, { token: reader.token });
    assert.deepEqual(readerList.body.data.myReviews, []);
    assert.equal(readerList.body.data.myReview, null);
    const summary = await call("GET", `/api/reviews/summary?restaurant=${half._id}`, { token: reader.token });
    assert.deepEqual(summary.body.data.summary.reviewStats, stats);
    const detail = await call("GET", `/api/restaurants/${half.slug}`, { token: reader.token });
    assert.equal(detail.body.data.restaurant.reviewCount, 2);
    assert.deepEqual(detail.body.data.restaurant.reviewStats, stats);
    const adminDetail = await call("GET", `/api/admin/restaurants/${half._id}`, { token: admin });
    assert.deepEqual(adminDetail.body.data.stats.reviewStats, stats);
    const mine = await call("GET", "/api/reviews/mine", { token: author.token });
    assert.equal(mine.body.data.reviews.filter((r) => String(r.restaurant?._id ?? r.restaurant) === half._id).length, 2);
    assert.deepEqual(mine.body.data.reviews[0].restaurant.reviewStats, stats);

    // "Best rated": liked % once a place has minReviewsForPercent reviews, then review count.
    const liked = await call("POST", "/api/reviews", { token: reader.token, body: { restaurant: full._id, sentiment: "liked" } });
    assert.equal(liked.status, 201, JSON.stringify(liked.body));
    const order = async () => {
      const res = await call("GET", `/api/restaurants/search?ids=${half._id},${full._id}&sort=rating`, { token: admin });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      res.body.data.restaurants.forEach((r) => assert.equal(r._bestRated, undefined));
      return res.body.data.restaurants.map((r) => r._id);
    };
    assert.deepEqual(await order(), [half._id, full._id]); // neither has 10 reviews → most reviewed first
    assert.equal((await settings({ ratingDisplay: { minReviewsForPercent: 0 } })).status, 400);
    assert.equal((await settings({ ratingDisplay: { minReviewsForPercent: 101 } })).status, 400);
    assert.equal((await settings({ ratingDisplay: { minReviewsForPercent: 1 } })).status, 200);
    const catalog = await call("GET", "/api/catalog", { token: reader.token });
    assert.equal(catalog.body.data.config.ratingDisplay.minReviewsForPercent, 1);
    assert.deepEqual(await order(), [full._id, half._id]); // 100% liked beats 50%

    // In-app sending is gone; external shares are still counted.
    const review = second.body.data.review._id;
    const toUser = await call("POST", `/api/reviews/${review}/share`, { token: reader.token, body: { recipients: [author.id] } });
    assert.equal(toUser.status, 400);
    assert.equal(toUser.body.code, "SHARE_DISABLED");
    const external = await call("POST", `/api/reviews/${review}/share`, { token: reader.token, body: { channel: "whatsapp" } });
    assert.equal(external.status, 200, JSON.stringify(external.body));
    assert.equal(external.body.data.shareCount, 1);
    const noChannel = await call("POST", `/api/reviews/${review}/share`, { token: reader.token, body: {} });
    assert.equal(noChannel.status, 400);
  } finally {
    await settings({ autoApproveReviews: false, ratingDisplay: { minReviewsForPercent: 10 } });
    await closeConn();
  }
});

// ------------------------------------------------ full-text search
test("search: full text over description (en / ru), az feature names, dish descriptions, menu sections; name ranks first", async () => {
  const token = (await call("POST", "/api/auth/login", { body: ADMIN })).body.data.tokens.accessToken;
  const make = async (name, extra = {}) => {
    const res = await call("POST", "/api/restaurants", {
      token,
      body: { name, address: "9 Text Street", avgPrice: 22, location: { type: "Point", coordinates: [49.83, 40.39] }, ...extra },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.restaurant;
  };
  const described = await make("Qwtext Harbour", {
    description: "Famous for zorblatt smoked fish.",
    translations: { ru: { description: "Знаменитый квржаркий суп" } },
    features: ["Parking"],
  });
  const named = await make("Zorblatt House");
  const plain = await make("Qwtext Plain");
  const ids = async (q, extra = "") => {
    // Signed in: the anonymous per-IP budget is shared by the whole suite.
    const res = await call("GET", `/api/restaurants/search?q=${encodeURIComponent(q)}${extra}`, { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.restaurants.map((r) => r._id);
  };

  // A word only in the description (English or a translation).
  const byDescription = await ids("zorblatt", "&sort=relevance");
  assert.ok(byDescription.includes(described._id), "description word finds the restaurant");
  assert.ok(byDescription.indexOf(named._id) < byDescription.indexOf(described._id), "a name hit ranks above a description hit");
  assert.ok((await ids("квржаркий")).includes(described._id), "ru description");

  // A feature by its az name ("Parking" → "Parkinq").
  const byFeature = await ids("qwtext parkinq");
  assert.ok(byFeature.includes(described._id), "az feature name finds the restaurant");
  assert.ok(!byFeature.includes(plain._id));

  // Dish descriptions and menu section names.
  const section = await call("POST", `/api/admin/restaurants/${plain._id}/menu/categories`, {
    token,
    body: { name: "Qwsection Grill", translations: { az: { name: "Qwbölmə Manqal" } } },
  });
  assert.equal(section.status, 201, JSON.stringify(section.body));
  const item = await call("POST", `/api/admin/restaurants/${plain._id}/menu/items`, {
    token,
    body: { name: "Lamb chops", description: "With qwsaffron rice", price: 14, category: section.body.data.category._id },
  });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  assert.ok((await ids("qwsaffron")).includes(plain._id), "dish description");
  assert.ok((await ids("qwsection")).includes(plain._id), "menu section name");
  assert.ok((await ids("qwbolme")).includes(plain._id), "az menu section name, letters folded");
  assert.ok(!(await ids("qwsaffron")).includes(described._id));
});
