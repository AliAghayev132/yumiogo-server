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

/** The last dev OTP the server printed for `email`. */
const otpFor = async (email) => {
  for (let i = 0; i < 50; i += 1) {
    const matches = [...output.matchAll(/\[DEV\] OTP for (\S+) \([^)]+\): (\d+)/g)].filter((m) => m[1] === email);
    if (matches.length) return matches.at(-1)[2];
    await sleep(100);
  }
  throw new Error(`No OTP printed for ${email}`);
};

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
  const code = await otpFor(USER.email);

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
