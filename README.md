# Yumio server — Express 5 + Mongoose 9 API

Yumio mobil tətbiqinin (`mobile/`) və admin panelinin (`admin-web/`) backend-i: restoran kəşfi, axtarış və xəritə, rəylər və şərhlər, siyahılar, sosial qraf, bildirişlər, moderasiya, admin kataloqu / məzmunu / ayarları. Eyni proses admin-web build-ini (`../admin-web/dist`) və paylaşım linklərinin landing səhifələrini də verir.

- **Runtime:** Node.js 20+ (ESM, `"type": "module"`), Express `^5.2`, Mongoose `^9.7`, Socket.IO `^4.8`
- **Auth:** JWT access (15 dəq) + refresh (rotasiya, cihaz başına "family") + reset token, bcrypt, 4 rəqəmli OTP (HMAC ilə saxlanır)
- **Port:** `PORT` (default `3042`; nginx `https://yumiogo.com` → `127.0.0.1:3042`)

---

## Əmrlər

```bash
npm install --legacy-peer-deps   # eslint 10 ↔ eslint-plugin-import peer konflikti
npm run dev                      # nodemon app.js
npm start                        # node app.js
npm run lint                     # eslint .
npm test                         # smoke test (aşağıya bax) — atılan (throwaway) DB ilə
npm run seed                     # demo data (production-da yalnız ENABLE_DEMO_SEED=true ilə)
npm run db:reset:demo            # yalnız demo data-nı silir (development)
npm run db:reset -- --yes        # bütün app data-nı silir (development, geri qaytarılmır)
```

Açılışda `✅ … ensured / ready` sətirləri və banner çıxır; `GET /api/health` → `{ success, mail: "configured"|"not-configured", maintenance }`.

---

## Mühit dəyişənləri (`.env.example`)

| Dəyişən | Nə üçündür |
|---|---|
| `NODE_ENV` | `development` / `production` (test üçün `test`). |
| `PORT` | Serverin portu (default `3042`). |
| `MONGODB_URI` | MongoDB bağlantısı (default `mongodb://localhost:27017/yumio`). |
| `ACCESS_SECRET_KEY`, `REFRESH_SECRET_KEY`, `ENCRYPTION_KEY` | Production-da **mütləq** (`openssl rand -hex 32`); default qalsa server qalxmır. |
| `APP_URL`, `CLIENT_URL`, `DOMAIN` | Public URL-lər, CORS (production-da yalnız https). |
| `WEB_URL` | Paylaşım linklərinin origin-i (`/list`, `/restaurant`, `/invite`, `/review`); default `APP_URL`. |
| `CLIENT_DIST` | Verilən admin build-i (default `../admin-web/dist`, sonra `../client/dist`). |
| `SMTP_*` | E-poçt. Production-da SMTP yoxdursa qeydiyyat / şifrə bərpası `503 MAIL_NOT_CONFIGURED` qaytarır; development-də OTP konsola yazılır. |
| `REQUIRE_SMTP` | `true` → production-da SMTP olmadan server qalxmır. |
| `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD` | İlk açılışda admin yaradılır. Production-da parol **mütləq** verilməlidir (development fallback-i qəbul olunmur, parol loga yazılmır). |
| `ENABLE_DEMO_SEED`, `ENABLE_DATA_WIPE` | Admin paneldəki demo data / "Delete all data" əməliyyatlarını production-da açır (default bağlı). |
| `GOOGLE_CLIENT_IDS` | "Continue with Google" üçün OAuth client id-lər (vergüllə); boşdursa `501`. |
| `NOMINATIM_URL` | Yer axtarışı (default OpenStreetMap Nominatim). |
| `APPLE_TEAM_ID`, `IOS_BUNDLE_ID` | iOS Universal Links (`/.well-known/apple-app-site-association`); team id Apple Developer hesabından, bundle id `mobile/app.json` → `ios.bundleIdentifier` (default `com.aliaghayev.yumio`). Boşdursa fayl `404`. |
| `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256` | Android App Links (`/.well-known/assetlinks.json`); paket `mobile/app.json` → `android.package` (`com.aliaghayev.yumio`), barmaq izləri vergüllə (`AB:CD:…`): release upload açarı (`~/.gradle/gradle.properties`-dəki `YUMIO_UPLOAD_*` keystore-u, `keytool -list -v`) və Play-dən paylanırsa Play App Signing açarı. Boşdursa `404`. |
| `DISABLE_UPLOAD_SWEEP` | `true` → istifadə olunmayan yükləmələrin silinməsi işləmir (test / müvəqqəti DB ilə qaldıranda **mütləq**; `NODE_ENV=test` də söndürür). |
| `TEST_MONGODB_URI` | `npm test` üçün Mongo server URI-si (DB adı olmadan; default `mongodb://127.0.0.1:27017`). |

---

## Struktur

```
app.js            giriş nöqtəsi: middleware sırası, route mount-ları, SPA fallback, fon işləri
config/           config, corsConfig, securityConfig
constants/shared/ enums, catalogDefaults (admin-in dəyişə bildiyi default-lar), paths
controllers/      HTTP handler-lər (asyncHandler + { success, message?, data } envelope)
i18n/             Accept-Language lokalizasiyası: messages.js (az / ru mətnlər), index.js
middlewares/      auth, rate limit, sanitize, errorHandler, maintenance, accountPolicy,
                  localize (dil), appVersion (/api/v1 + minimum app versiyası), validate
models/           Mongoose modelləri (Restaurant, Review, Comment, FavoriteList, User, …)
routes/           /api/* router-ləri (admin: routes/adminRoutes.js)
services/         biznes məntiqi (ReviewService, RestaurantQueryService, CatalogService,
                  ModerationService, LinkPreviewService, …) + fon işləri
templates/        e-poçt şablonları (en / az / ru)
test/             node:test smoke testləri
uploads/          yüklənən şəkillər (uploads/catalog/defaults/** git-dədir, silinmir)
```

Import-lar `#` alias-ları ilə gedir (`package.json` → `"imports"`): `#services`, `#models`, `#utils`, `#config`, `#constants`, `#middlewares`, `#controllers`, `#lib` (bütün npm paketləri buradan), və konkret fayl üçün `#*` (məs. `#i18n/index.js`, `#services/MailService.js` — dövri import-dan qaçmaq üçün). Hər qovluğun `index.js` barrel-i var; yeni fayl əlavə edəndə barrel-ə bir sətir yazılır.

Mongoose 9 hook-ları `next` olmadan (sync / async) yazılır.

---

## API qaydaları

- **Envelope:** `{ success, message?, data?, errors?, code? }`. Xəta cavablarında sabit **`code`** var (`INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `OTP_INVALID`, `PASSWORD_WEAK`, `INVALID_ID`, `VALIDATION_ERROR`, `RATE_LIMITED`, `APP_UPDATE_REQUIRED`, …). Klientlər mətnə yox, `code`-a baxmalıdır.
- **Dil:** `Accept-Language: az` / `ru` göndərilsə, `code`-u olan xətaların `message`-i həmin dildə qayıdır (`Content-Language` başlığı ilə); `code`, status və digər sahələr dəyişmir. Başlıq yoxdursa və ya `en`-dirsə mətn ingiliscədir. Tərcümələr: `i18n/messages.js` (`ERROR_MESSAGES[code] = { az, ru }`). Yeni `code` əlavə edəndə oraya da əlavə et. OTP / welcome / new-follower e-poçtları da `az` / `ru` gedir (Accept-Language, yoxdursa istifadəçinin `language`-i). Admin-in yazdığı məzmun (kataloq adları, FAQ, hüquqi səhifələr, maintenance mesajı) olduğu kimi qalır.
- **Versiyalama:** hazırkı API `v1`-dir. `/api/v1/*` və `/api/*` eyni route-lardır (alias), hər cavabda `X-API-Version: 1`. Qayda: v1-də yalnız geri-uyğun dəyişikliklər (yeni sahə / endpoint / optional parametr); sındıran dəyişiklik `/api/v2` kimi yanaşı çıxmalıdır, çünki quraşdırılmış tətbiqlər dərhal yenilənmir.
- **Minimum app versiyası:** Admin → Settings → `appVersion: { minSupported, latest }` (`PUT /api/admin/settings`, `"1.4.0"` formatı, boş = yoxlama yoxdur). `GET /api/catalog` → `config.appVersion = { minSupported, latest, storeUrls: { ios, android } }`. Tətbiq hər sorğuda `X-App-Version` (və `X-App-Platform: ios|android`) göndərərsə və versiyası `minSupported`-dan aşağıdırsa, API `426 { code: "APP_UPDATE_REQUIRED", data: { minSupported, latest, storeUrl } }` qaytarır (health / catalog / content / admin / logout həmişə açıqdır). Başlıq göndərməyən köhnə build-lər bloklanmır — onlar `config.appVersion`-u özləri müqayisə etməlidir.
- **Id-lər:** səhv ObjectId → `400 INVALID_ID`; tapılmayan → `404 …_NOT_FOUND`.
- **Rate limit:** anonim 120/dəq (IP), daxil olmuş istifadəçi 300/dəq, admin 1000/dəq; yazma əməliyyatları istifadəçi başına 100 / 15 dəq; login yalnız uğursuz cəhdləri sayır; OTP endpoint-ləri e-poçt + IP ilə. Store yaddaşdadır (restartda sıfırlanır, PM2 cluster-də paylaşılmır — lazım olsa Redis store).
- **Yükləmə:** yalnız real JPG / PNG / WebP / GIF (fayl baytlarından yoxlanır), 10 MB, sorğuda 8 fayl; rəy şəkilləri üçün istifadəçi başına 24 saatda 60 fayl / 200 MB (`429 UPLOAD_QUOTA`). `/uploads` `nosniff` + `sandbox` ilə verilir.

### Auth (qısa)

`POST /api/auth/check-email` → `register` (4 rəqəmli kod) → `verify-otp` → `{ user, tokens }`. `login`, `google`, `forgot-password` → `verify-reset-otp` → `reset-password` (tək istifadəlik token). `refresh` hər dəfə **yeni** refresh token qaytarır (köhnəsi yenidən gəlsə bütün sessiyalar ləğv olunur: `REFRESH_TOKEN_REUSED`). `logout { refreshToken }` → yalnız bu cihaz (`scope: "device"`); `refreshToken`-siz və ya `logout-all` → bütün cihazlar (`scope: "all"`). Parol qaydası: ≥6 simvol, 1 böyük hərf, 1 rəqəm və ya xüsusi simvol (`GET /api/auth/config`).

### Paylaşım linklərinin önizləməsi (Open Graph)

WhatsApp / iMessage / Telegram crawler-ləri JavaScript işlətmir. Ona görə SPA fallback `/restaurant/:idOrSlug`, `/list/:slug`, `/invite/:code`, `/review/:id` üçün `index.html`-ə `og:*` / `twitter:*` teqləri (title, description, image, url) yazır — yalnız ictimai data (aktiv restoran; public / collaborative siyahı; aktiv dəvət edənin adı; təsdiqlənmiş rəyin yalnız restoranı), hamısı HTML-escape olunur, 1 dəqiqəlik cache. Restoran səhifələri `index, follow`, qalanları `noindex`; admin yolları dəyişmədən (`noindex, nofollow`). Default şəkil: `uploads/catalog/defaults/brand/og-default.png`. Kod: `services/LinkPreviewService.js`.

### Universal Links / App Links

`GET /.well-known/apple-app-site-association` (həmçinin kökdə `/apple-app-site-association`) və `GET /.well-known/assetlinks.json` — `/list/*`, `/restaurant/*`, `/invite/*`, `/review/*` linkləri quraşdırılmış tətbiqdə açılsın deyə; `application/json`, redirect-siz, SPA fallback-dan əvvəl. Tətbiq tərəfində iOS `associatedDomains` (`applinks:yumiogo.com`) və Android `autoVerify` intent filter lazımdır (yeni native build).

### Fon işləri (açılışda + intervalla)

Açılış saatları → `openNow` və bitmiş endirimlərin (`discountEndsAt`) söndürülməsi (5 dəq) · həftəlik restoran statistikası (10 dəq) · reytinq self-heal və istifadə olunmayan rəy şəkilləri (6 saat) · istifadə olunmayan admin yükləmələri (6 saat) · bitən müvəqqəti bloklar (1 dəq) · restoran izləyiciləri / `followerCount` uzlaşdırması (açılışda).

> ⚠️ Yükləmə təmizləyiciləri faylları **qoşulu DB**-yə görə mühakimə edir və `uploads/`-u iş qovluğundan götürür. Serveri heç vaxt `server/` qovluğundan başqa (test / müvəqqəti) DB ilə qaldırma; qaldırmalı olsan `DISABLE_UPLOAD_SWEEP=true` və ayrıca iş qovluğu istifadə et (`npm test` bunu özü edir).

---

## Test və CI

`npm test` (`test/smoke.test.js`, `node:test`, əlavə paket yoxdur):

- `app.js`-i ayrıca prosesdə, **müvəqqəti qovluqda** (öz `uploads/`-u və stub admin build-i ilə) və **atılan DB**-də (`yumio_test_<random>`) qaldırır; `NODE_ENV=test` + `DISABLE_UPLOAD_SWEEP=true` ilə yükləmə təmizləyiciləri söndürülür; `.env` oxunmur, real DB-yə və real `uploads/`-a toxunmur; sonda DB drop olunur.
- Yoxlayır: health + `/api/v1` alias + 404 envelope; `/.well-known` faylları; catalog (`config.appVersion`); Accept-Language lokalizasiyası; qeydiyyat → OTP → verify → `/auth/me`, zəif parol; rəy şəkli yükləmə (magic byte yoxlaması); admin girişi, `INVALID_ID`, restoran yaratma / axtarış / endirim bitmə tarixi; OG önizləmələri (escape, noindex); admin siyahı moderasiyası; minimum app versiyası (`426`); Trash-dan həmişəlik silmədə izləyicilərin silinməsi; cihaz üzrə logout.

CI: `.github/workflows/deploy.yml` — `checks` job-u (MongoDB service container, `npm ci`, `npm run lint`, `npm test`) hər PR-da və `main`-ə push-da işləyir; deploy yalnız `main` push-unda və yalnız `checks` keçdikdən sonra gedir. Deploy health check-i SMTP konfiqurasiya olunmayıbsa xəbərdarlıq edir.

---

## Hələ görülməyənlər (infra / məhsul qərarı tələb edir)

- **Crash reporting / alerting:** server gözlənilməz xətaları (`unhandledRejection`, `uncaughtException`) vaxt damğası ilə PM2 loguna yazır, `uncaughtException`-da proses çıxır və PM2 yenidən başladır. Sentry (server + mobil, source map-lərlə) üçün hesab / DSN və mobil tərəfdə native SDK lazımdır — yeni dev build tələb edir. Uptime üçün `GET /api/health`-i xarici monitorla (məs. UptimeRobot) izləmək tövsiyə olunur.
- **Şəkil ölçüləndirmə** (320 / 720 / 1280 variantları, EXIF silmə): `sharp` native paketi və ya CDN / resize proxy tələb edir; hazırda orijinal saxlanır (10 MB limit + kvota).
- **Admin-web və mobil üçün:** admin Settings-də `appVersion` sahələri, restoran formasında `discountEndsAt`, siyahı moderasiyası səhifəsi (`/api/admin/lists`) və report-da `remove_list` əməliyyatı; mobil tərəfdə `Accept-Language`, `X-App-Version` / `X-App-Platform` başlıqları, `426` üçün məcburi yeniləmə ekranı, logout-da `refreshToken` göndərilməsi, `associatedDomains` / `autoVerify` (Universal / App Links), "Suggested" sətirlərində `reason`-un strukturlu parametrlərindən (`name`, `count`, `more`, `city`, `cuisine`) tərcümə.
- **Admin-web və mobil CI** öz repolarında ayrıca qurulmalıdır (lint + build / `expo export`).
- **Kontent dilləri:** restoran və kataloq məzmunu tək dildədir (kataloqun sabit `slug`-u var); az / ru məzmun sahələri məhsul qərarı və admin formalarında dil tabları tələb edir.
