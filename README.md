# Server — Express.js Backend Template

Generic Express.js backend starter (`starter-server`, v1.0.0). Bu paket bir REST API + real-time (Socket.IO) backend-in **yenidən istifadə oluna bilən skeletidir**: hazır autentifikasiya (register → OTP → verify → login → refresh), OTP e-poçt axını, nümunə CRUD resursu (`Post`), fayl yükləmə, təhlükəsizlik middleware-ləri və servis qatı ilə gəlir. Yeni layihəyə başlayarkən bu qovluğu kopyalayıb, `Post` nümunəsini öz modelinlə əvəz edərək dərhal işə başlaya bilərsən.

- **Runtime:** Node.js (ESM, `"type": "module"`)
- **Framework:** Express `^5.2.1`
- **Database:** MongoDB + Mongoose `^9.7.3`
- **Real-time:** Socket.IO `^4.8.3`
- **Auth:** JWT (access + refresh + reset) + bcrypt + OTP

---

## Məqsəd

Bu template-in məqsədi hər yeni backend layihəsində eyni "boilerplate" işləri sıfırdan yazmamaqdır. Aşağıdakılar artıq qurulub və işlək vəziyyətdədir:

- **İki-mərhələli qeydiyyat** — parol OTP təsdiqindən keçənə qədər `OTP` sənədində saxlanır, istifadəçi yalnız kod təsdiqləndikdən sonra yaradılır.
- **Access / Refresh token** sistemi httpOnly cookie + `Authorization: Bearer` başlığı ilə, `tokenVersion` vasitəsilə "bütün cihazlardan çıxış" dəstəyi.
- **Şifrənin sıfırlanması** üç mərhələdə (OTP → reset token → yeni parol).
- **Nümunə resurs (`Post`)** — bütün Mongoose konvensiyalarını (virtual, static, instance metod, pre-save hook, compound index, soft-delete) nümayiş etdirən referans model + tam CRUD controller/route.
- **Təhlükəsizlik** — Helmet, CORS whitelist, NoSQL injection sanitizer, rate limit (API / login / write), güvənli fayl yükləmə.
- **Servis qatı** — Mail, Hash, Encryption, File, AuthToken, MongoDB, Socket, Bootstrap servisləri.
- **`#` subpath-import alias sistemi** + hər qovluqda barrel `index.js` — import-lar həmişə qısa və sabit qalır.

---

## Qovluq ağacı (annotasiyalı)

`node_modules` xaric bütün fayllar:

```
server/
├── .env.example              # Bütün mühit dəyişənlərinin nümunəsi (kopyala → .env)
├── .gitignore                # node_modules, .env, uploads, loglar
├── .prettierrc               # Prettier qaydaları (semi, double-quote, printWidth 80)
├── eslint.config.js          # ESLint flat config (Node globals, no-var, _-ignore)
├── package.json              # Skriptlər, asılılıqlar və "imports" (# alias) xəritəsi
├── app.js                    # Tətbiqin giriş nöqtəsi: middleware/route/servis quraşdırması, bootstrap
│
├── config/
│   ├── config.js             # config, corsConfig, securityConfig — bütün mərkəzi konfiqurasiya
│   └── index.js              # barrel → export * from "./config.js"
│
├── constants/
│   ├── index.js              # barrel → shared/index.js re-export
│   └── shared/
│       ├── index.js          # enums + paths + variables barrel
│       ├── enums.js          # userRoles, accountStatus, postStatus, otpTypes
│       ├── paths.js          # uploadPaths (uploads/, uploads/avatars, uploads/posts)
│       └── variables.js      # Schema, Model, Router (mongoose + express qısaltmaları)
│
├── controllers/
│   ├── index.js              # export * as authController / postController
│   ├── authController.js     # register, verifyOTP, login, refresh, logout, forgot/reset, profile, avatar
│   └── postController.js     # NÜMUNƏ CRUD: list/get/create/update/delete
│
├── lib/
│   └── index.js              # Bütün NPM + Node built-in paketlərinin MƏRKƏZİ re-export-u
│
├── middlewares/
│   ├── index.js              # auth + security + sanitize barrel
│   ├── auth.js               # authenticate, authenticateRefreshToken, authenticateResetToken, requireRole
│   ├── security.js           # apiRateLimiter, loginRateLimiter, writeRateLimiter, securityHeaders, noCookies
│   └── sanitize.js           # sanitizeInput — NoSQL injection ($ operatorlarını təmizləyir)
│
├── models/
│   ├── index.js              # User, OTP, Post barrel
│   ├── user.model.js         # İstifadəçi sxemi (role, status, tokenVersion, soft-delete)
│   ├── otp.model.js          # OTP sxemi (TTL index, createOTP/verifyOTP static-ləri)
│   └── post.model.js         # NÜMUNƏ MODEL: virtual, static, instance metod, pre-save hook, index
│
├── routes/
│   ├── index.js              # AuthRouter, PostRouter barrel
│   ├── authRoutes.js         # /api/auth/* marşrutları
│   └── postRoutes.js         # /api/posts/* marşrutları (NÜMUNƏ)
│
├── scripts/
│   └── resetDatabase.js      # Bütün kolleksiyaları təmizləyən skript (node scripts/resetDatabase.js)
│
├── services/
│   ├── index.js              # Bütün servislərin barrel-i
│   ├── AuthTokenService.js   # JWT access/refresh/reset token generasiya + doğrulama (static)
│   ├── BootstrapService.js   # İlk açılışda default admin yaradır
│   ├── EncryptionService.js  # AES-256-GCM şifrələmə, sha256 hash, slug generasiya (static)
│   ├── FileService.js        # Fayl validasiya + təhlükəsiz saxlama (path traversal qorunması)
│   ├── HashService.js        # bcrypt ilə parol hash/compare (static, saltRounds=12)
│   ├── MailService.js        # nodemailer wrapper: sendOTP, sendWelcome (static)
│   ├── MongoDBService.js     # Tək mongoose bağlantısı (singleton)
│   └── SocketService.js      # Socket.IO real-time qatı (room-lar, auth, singleton)
│
├── templates/
│   ├── index.js              # baseTemplate, otpTemplate, welcomeTemplate barrel
│   ├── baseTemplate.js       # Ümumi HTML e-poçt karkası
│   ├── otpTemplate.js        # OTP kodu e-poçt şablonu
│   └── welcomeTemplate.js    # Xoş gəldin e-poçt şablonu
│
├── uploads/
│   └── .gitkeep              # Yüklənən faylların qovluğu (məzmun ignore olunur)
│
└── utils/
    ├── index.js              # asyncHandler, ok, fail barrel
    ├── asyncHandler.js       # Async route-ları try/catch-siz sarıyan wrapper
    └── apiResponse.js        # ok()/fail() — standart cavab envelope-u
```

> `find . -type f -not -path './node_modules/*' | sort` əmri ilə bu ağacı istənilən vaxt yenidən yoxlaya bilərsən.

---

## `#` Subpath-import alias sistemi

Bu template **nisbi import-lardan (`../../services/...`) tamamilə imtina edir**. Bunun əvəzinə Node.js-in doğma [subpath imports](https://nodejs.org/api/packages.html#subpath-imports) xüsusiyyəti (`package.json` → `"imports"`) istifadə olunur. Alias-lar `#` ilə başlayır və yalnız paketin daxilində işləyir:

```jsonc
// package.json
"imports": {
  "#*": "./*",                                  // wildcard — istənilən faylı birbaşa aç
  "#lib": "./lib/index.js",
  "#utils": "./utils/index.js",
  "#models": "./models/index.js",
  "#routes": "./routes/index.js",
  "#config": "./config/index.js",
  "#services": "./services/index.js",
  "#templates": "./templates/index.js",
  "#constants": "./constants/index.js",
  "#middlewares": "./middlewares/index.js",
  "#controllers": "./controllers/index.js"
}
```

İki mexanizm var:

1. **Barrel alias-ları** — `#services`, `#models`, `#config` və s. birbaşa həmin qovluğun `index.js` (barrel) faylına yönəlir. Beləliklə:

   ```js
   import { HashService, MailService } from "#services";
   import { User, OTP } from "#models";
   import { config } from "#config";
   ```

2. **Wildcard (`#*` → `./*`)** — konkret bir fayla birbaşa daxil olmaq lazım olduqda işə düşür. Məsələn dövri import (circular import) problemini həll etmək üçün `post.model.js` servisi barrel yerinə birbaşa faylından çəkir:

   ```js
   // models/post.model.js — #services barrel-i models <-> services dövrü yaradardı
   import { EncryptionService } from "#services/EncryptionService.js";
   ```

### Barrel `index.js` pattern-i

Hər qovluğun bir `index.js` (barrel) faylı var və o qovluğun bütün public export-larını bir yerdə toplayır. Yeni fayl əlavə edəndə **sadəcə barrel-ə bir sətir əlavə edirsən**, qalan bütün kod dəyişmir:

```js
// services/index.js
export { HashService } from "./HashService.js";
export { MailService } from "./MailService.js";
export { FileService } from "./FileService.js";
export { AuthTokenService } from "./AuthTokenService.js";
export { EncryptionService } from "./EncryptionService.js";
export { bootstrapAdmin } from "./BootstrapService.js";
export { default as socketService } from "./SocketService.js";
export { MongoDBService, mongoDBService } from "./MongoDBService.js";
```

**Xüsusi hallar:**
- `lib/index.js` — bütün üçüncü tərəf və Node built-in paketləri (http, fs, path, crypto, cors, helmet, express, mongoose, jwt, bcrypt, nodemailer, socket.io və s.) burada bir yerdə re-export olunur. Kodda paketi birbaşa deyil, `#lib`-dən çəkirsən: `import { express, jwt, bcrypt } from "#lib"`.
- `constants/shared/variables.js` — `Schema = mongoose.Schema`, `Model = mongoose.model`, `Router = () => ExpressRouter()` qısaltmaları verir ki, modellər və route-lar mongoose/express-i birbaşa import etməsin.
- `controllers/index.js` — namespace kimi export edir: `export * as authController from "./authController.js"`, sonra `authController.login` kimi istifadə olunur.

---

## Kitabxanalar cədvəli

`package.json`-dan **dəqiq versiyalar** və hər birinin rolu:

### `dependencies`

| Paket | Versiya | Rolu |
|---|---|---|
| `express` | `^5.2.1` | Web framework (routing, middleware) — Express **5** |
| `mongoose` | `^9.7.3` | MongoDB ODM (sxemlər, modellər, sorğular) |
| `socket.io` | `^4.8.3` | Real-time WebSocket qatı (`SocketService`) |
| `jsonwebtoken` | `^9.0.3` | JWT access / refresh / reset token imzalama və doğrulama |
| `bcryptjs` | `^3.0.3` | Parol hash-ləmə (saltRounds=12) |
| `nodemailer` | `^9.0.3` | SMTP vasitəsilə e-poçt göndərmə (OTP, welcome) |
| `helmet` | `^8.2.0` | Təhlükəsizlik başlıqları (CSP, HSTS və s.) |
| `cors` | `^2.8.6` | Cross-Origin sorğu icazələri (whitelist) |
| `express-rate-limit` | `^8.5.2` | Sürət limiti (API / login / write) |
| `express-fileupload` | `^1.5.2` | `multipart/form-data` fayl yükləmə |
| `compression` | `^1.8.1` | Gzip cavab sıxılması |
| `dotenv` | `^17.4.2` | `.env` fayllarının yüklənməsi |
| `validator` | `^13.15.35` | Sətir validasiya köməkçiləri (e-poçt və s.) |
| `uuid` | `^14.0.1` | Unikal identifikator generasiyası |

### `devDependencies`

| Paket | Versiya | Rolu |
|---|---|---|
| `nodemon` | `^3.1.14` | Dev-də avtomatik restart (`npm run dev`) |
| `eslint` | `^10.6.0` | Linter (flat config) |
| `eslint-config-prettier` | `^10.1.8` | ESLint ↔ Prettier konfliktlərini söndürür |
| `eslint-plugin-import` | `^2.32.0` | Import qaydaları plugini |
| `prettier` | `^3.9.4` | Kod formatlayıcı |

---

## Run əmrləri

```bash
# Asılılıqları qur
pnpm install

# Development — nodemon ilə (fayl dəyişəndə avtomatik restart)
pnpm dev            # → nodemon app.js

# Production
pnpm start          # → node app.js

# Lint
pnpm lint           # → eslint .

# Format
pnpm format         # → prettier --write .
```

Əlavə köməkçi skript (package.json-da yoxdur, birbaşa çağırılır):

```bash
# DİQQƏT: bütün kolleksiyaları (User, OTP, Post) təmizləyir — yalnız dev/test üçün
node scripts/resetDatabase.js
```

Server standart olaraq **`PORT` (default 5000)** portunda qalxır. Uğurlu açılışda konsola ASCII banner çıxır və `GET /api/health` sağlamlıq endpoint-i aktiv olur.

---

## `.env.example` izahı

`.env.example`-i `.env`-ə kopyala və dəyərləri doldur. `config/config.js` əvvəlcə `.env.<NODE_ENV>` (məs. `.env.development`), sonra `.env` faylını yükləyir — ilk tapılan dəyər qazanır.

| Dəyişən | Nə üçündür |
|---|---|
| `NODE_ENV` | `development` / `production`. Production-da secret-lərin default qalmasını yoxlayır və cookie-ləri `secure`/`strict` edir. |
| `PORT` | Serverin qalxdığı port (default `5000`). |
| `MONGODB_URI` | Tam MongoDB bağlantı sətri. Verilibsə, `DB_*` dəyişənlərini üstələyir. |
| `DB_HOST` | MongoDB host (URI verilməyəndə fallback). |
| `DB_NAME` | Verilənlər bazasının adı (default `starter`). |
| `DB_USERNAME` | DB istifadəçi adı (fallback bağlantı üçün). |
| `DB_PASSWORD` | DB parolu. |
| `DB_CLUSTER_NAME` | Atlas cluster adı (lazım olduqda). |
| `ACCESS_SECRET_KEY` | Access token imzalama açarı. **Production-da mütləq güclü random dəyər** — default qalarsa server qalxmır. |
| `REFRESH_SECRET_KEY` | Refresh token imzalama açarı (eyni qayda). |
| `ENCRYPTION_KEY` | AES-256 şifrələmə + reset token açarı (32 simvol). |
| `DOMAIN` | Əsas domen (cookie domain və CORS üçün). |
| `APP_URL` | Backend-in public URL-i (default `http://localhost:5000`). |
| `CLIENT_URL` | Frontend-in URL-i (CORS whitelist + welcome e-poçtdakı link, default `http://localhost:5173`). |
| `SMTP_HOST` | SMTP server (məs. `smtp.gmail.com`). |
| `SMTP_PORT` | SMTP portu (default `587`). |
| `SMTP_USER` | SMTP istifadəçi/e-poçt. **Boş olarsa mail göndərmə no-op olur** (konsola xəbərdarlıq). |
| `SMTP_PASS` | SMTP parolu / app password. |
| `SMTP_SECURE` | `true` olduqda TLS (port 465). Default `false` (STARTTLS, 587). |
| `DEFAULT_ADMIN_EMAIL` | İlk açılışda yaradılan admin-in e-poçtu (default `admin@example.com`). |
| `DEFAULT_ADMIN_PASSWORD` | Həmin admin-in parolu (default `Admin123!` — **dərhal dəyiş**). |

> Production-da `app.js` içindəki `validateEnv()` `ACCESS_SECRET_KEY`, `REFRESH_SECRET_KEY`, `ENCRYPTION_KEY` və `MONGODB_URI`-ni yoxlayır; hər hansı biri default və ya boşdursa proses `exit(1)` edir.

---

## Autentifikasiya axını

Bütün cavablar standart envelope-dadır: `{ success, message?, data?, errors? }`. Token-lar həm `data.tokens`-də qaytarılır, həm də httpOnly cookie kimi (`__starter_at`, `__starter_rt`) qoyulur.

### 1. Qeydiyyat (iki mərhələ)

```
POST /api/auth/register        → firstName, lastName, email, password[, phone]
```
- Parol hash-lənir və istifadəçi **hələ yaradılmır** — `OTP` sənədinin `data` sahəsində saxlanır.
- 6 rəqəmli OTP generasiya olunur (10 dəq TTL) və e-poçta göndərilir.
- Cavab: `{ email, expiresIn }`.

```
POST /api/auth/verify-otp      → email, code
```
- OTP doğrulanır (`OTP.verifyOTP` — 5 səhv cəhddən sonra kod silinir, müddət yoxlanılır).
- Uğurlu olduqda `User` yaradılır, welcome e-poçtu fire-and-forget göndərilir, token-lar verilir.
- Cavab: `{ user, tokens }` (status 201).

```
POST /api/auth/resend-otp      → email[, type]   # yeni kod göndərir
```

### 2. Giriş

```
POST /api/auth/login           → email, password[, rememberMe]
```
- `loginRateLimiter` (15 dəqiqədə maks 10 cəhd) tətbiq olunur.
- Parol `bcrypt.compare` ilə yoxlanır, `status === "active"` tələb olunur.
- `rememberMe` true olduqda refresh token 30 gün (default 7 gün) yaşayır.
- Cavab: `{ user, tokens }`.

### 3. Token yeniləmə

```
POST /api/auth/refresh         # Authorization: Bearer <refreshToken>
```
- `authenticateRefreshToken` middleware refresh token-i doğrulayır və `req.user`-ı doldurur.
- Yeni access + refresh token verilir (köhnə token-in ömründən `rememberMe` təxmin edilir).

### 4. Çıxış və digər

```
POST /api/auth/logout          # tokenVersion++ → bütün cihazlarda token-ları etibarsız edir
GET  /api/auth/me              # cari istifadəçi
PUT  /api/auth/change-password # currentPassword, newPassword (tokenVersion++)
PUT  /api/auth/profile         # firstName, lastName, phone
PUT  /api/auth/avatar          # multipart avatar faylı (FileService nümunəsi)
```

### 5. Şifrənin sıfırlanması (üç mərhələ)

```
POST /api/auth/forgot-password    → email                    # OTP göndərir (enumerasiyaya qarşı həmişə success)
POST /api/auth/verify-reset-otp   → email, code              # → { resetToken } (10 dəq)
POST /api/auth/reset-password     → newPassword + resetToken # authenticateResetToken qoruyur
```

**Token strategiyası (`AuthTokenService`):** access token 15 dəq (`accessSecretKey`), refresh token 7g/30g (`refreshSecretKey`), reset token 10 dəq (`encryptionKey` ilə, `purpose: "reset-password"` yoxlanılır). `authenticate` middleware access token-i doğrulayır və `decoded.tokenVersion === user.tokenVersion` şərtini yoxlayaraq "logout all devices"-i təmin edir.

---

## Yeni model / route / controller / service necə əlavə olunur

`Post` resursu bütün template boyunca **referans pattern** kimi qurulub — yeni resurs əlavə edərkən onu kopyala. Fərz edək `Comment` resursu əlavə edirik:

### 1. Model — `models/comment.model.js`

`post.model.js`-i nümunə götür. O, qəsdən bütün Mongoose konvensiyalarını göstərir:

```js
import { Schema, Model, someEnum } from "#constants";
// Circular import riski varsa servisi birbaşa faylından çək:
// import { EncryptionService } from "#services/EncryptionService.js";

const commentSchema = new Schema(
  {
    content: { type: String, required: true, trim: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false, toJSON: { virtuals: true } }
);

commentSchema.index({ author: 1, createdAt: -1 });          // compound index
commentSchema.statics.findActive = function () {             // static metod
  return this.find({ isDeleted: false });
};
commentSchema.methods.softDelete = async function () {       // instance metod
  this.isDeleted = true;
  return this.save();
};

export const Comment = Model("Comment", commentSchema);
```

Sonra barrel-ə əlavə et:

```js
// models/index.js
export { Comment } from "./comment.model.js";
```

Əgər yeni enum lazımdırsa `constants/shared/enums.js`-ə əlavə et və `#constants`-dan çək.

### 2. Controller — `controllers/commentController.js`

`postController.js`-i kopyala. Bütün handler-ları `asyncHandler` ilə sarı (try/catch avtomatik):

```js
import { Comment } from "#models";
import { asyncHandler } from "#utils";

const listComments = asyncHandler(async (req, res) => {
  const comments = await Comment.findActive().populate("author", "firstName lastName");
  res.json({ success: true, data: { comments } });
});

const createComment = asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ success: false, message: "Content required" });
  const comment = await Comment.create({ content, author: req.user._id });
  res.status(201).json({ success: true, message: "Comment created", data: { comment } });
});

export { listComments, createComment };
```

Barrel:

```js
// controllers/index.js
export * as commentController from "./commentController.js";
```

### 3. Route — `routes/commentRoutes.js`

`postRoutes.js`-i kopyala. `Router`-ı `#constants`-dan, controller-i `#controllers`-dan, middleware-ləri `#middlewares`-dan çək:

```js
import { Router } from "#constants";
import { commentController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";

const CommentRouter = Router();

CommentRouter.get("/", commentController.listComments);                                  // public
CommentRouter.post("/", authenticate, writeRateLimiter, commentController.createComment); // qorunan

export { CommentRouter };
```

Barrel:

```js
// routes/index.js
export { CommentRouter } from "./commentRoutes.js";
```

### 4. `app.js`-də mount et

```js
// app.js — importa əlavə et
import { AuthRouter, PostRouter, CommentRouter } from "#routes";

// setupRoutes(app) daxilində:
app.use("/api/comments", CommentRouter);
```

### 5. (İstəyə bağlı) Service — `services/CommentService.js`

Biznes məntiqi mürəkkəbləşəndə onu static class kimi servis qatına çıxar (bax `HashService`, `FileService`). Sonra `services/index.js`-ə export əlavə et və controller-də `#services`-dan çək.

> **Xülasə:** yeni resurs = model + controller + route yarat, hər üçünü öz barrel-inə əlavə et, `app.js`-də mount et. Real-time lazımdırsa `SocketService.emitToRoom(...)` istifadə et, mail lazımdırsa `MailService`-ə yeni metod əlavə et.
