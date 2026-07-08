# middlewares

## Məqsəd

Bu qovluq Express middleware funksiyalarını saxlayır — yəni request-lə route handler-i arasında işləyən aralıq mərhələləri. Burada üç mövzu qruplaşdırılır: `auth.js` (token doğrulaması və rol yoxlaması: `authenticate`, `authenticateRefreshToken`, `authenticateResetToken`, `requireRole`), `security.js` (rate limiting, security header-lər, cookie məhdudiyyəti) və `sanitize.js` (NoSQL injection-a qarşı input təmizləməsi). Bu funksiyalar route-lara qoşularaq autentifikasiya, təhlükəsizlik və giriş validasiyasını təmin edir.

## Adlandırma / yazılış konvensiyası

Fayllar mövzuya görə adlandırılır (`auth.js`, `security.js`, `sanitize.js`) və hər middleware `(req, res, next)` imzası ilə yazılıb adlandırılmış export kimi verilir. `index.js` barrel bütün faylları `export * from "./auth.js";` formasında birləşdirir, qovluq isə route-larda `#middlewares` alias-ı ilə import olunur. Parametr tələb edən middleware-lər factory funksiya kimi yazılır (məs. `requireRole(["admin"])` bir middleware qaytarır).

## Nümunə

`auth.js` faylından:

```js
const authenticate = async (req, res, next) => {
  const authHeader = req.header("Authorization");
  const token = authHeader.replace("Bearer ", "");
  const decoded = jwt.verify(token, config.accessSecretKey);
  const user = await User.findById(decoded.id).select("-password");
  req.user = user;
  next();
};
export { authenticate, authenticateRefreshToken, authenticateResetToken, requireRole };
```

`index.js` bunu `export * from "./auth.js";` ilə ixrac edir və route faylında belə işlədilir: `import { authenticate, requireRole } from "#middlewares";` → `router.get("/me", authenticate, authController.getMe)`.

## Yeni fayl necə əlavə olunur

1. Yeni mövzu faylı yarat (məs. `upload.js`), middleware-i `(req, res, next)` imzası ilə yaz və `export { validateUpload }` ilə ixrac et.
2. `index.js` barrel-ə əlavə et: `export * from "./upload.js";`.
3. Route-da `#middlewares` alias-ı ilə import et: `import { validateUpload } from "#middlewares";`.
