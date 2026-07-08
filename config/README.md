# config

## Məqsəd

Bu qovluq serverin bütün konfiqurasiya dəyərlərini bir mərkəzdə toplayır. Burada `.env` fayllarından oxunan environment dəyişənləri emal olunur və tətbiqin qalan hissəsinin istifadə etdiyi hazır obyektlərə çevrilir: ümumi `config` (port, DB, cookie adları, token müddətləri, SMTP, OTP), `corsConfig` (CORS whitelist) və `securityConfig` (payload limitləri, session timeout). Məqsəd budur ki, kod boyu heç yerdə birbaşa `process.env`-ə müraciət olunmasın — hər şey bu vahid mənbədən gəlsin.

## Adlandırma / yazılış konvensiyası

Bütün konfiqurasiya `config.js` faylında yazılır və adlandırılmış (named) export kimi verilir: `export { config, corsConfig, securityConfig }`. `index.js` yalnız barrel rolunu oynayır (`export * from "./config.js"`) və qovluq başqa yerlərdə `#config` alias-ı ilə import olunur. Yeni dəyər əlavə edərkən əvvəlcə `process.env.X`, sonra məntiqli default verilir (məs. `process.env.PORT || 5000`), production-a xas dəyərlər isə `isProduction` bayrağı ilə şaxələnir.

## Nümunə

`config.js` faylından cookie parametrləri:

```js
const config = {
  accessCookieName: "__starter_at",
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    path: "/",
  },
};
export { config, corsConfig, securityConfig };
```

Bu obyekt `index.js` barrel-i vasitəsilə ixrac olunur və məsələn controller-də belə istifadə edilir: `import { config } from "#config";` → `res.cookie(config.accessCookieName, token, config.cookie)`.

## Yeni fayl necə əlavə olunur

1. Ehtiyac varsa yeni konfiqurasiya faylı yarat (məs. `payment.js`) və dəyəri named export kimi ver: `export { paymentConfig }`.
2. `index.js` barrel-ə əlavə et: `export * from "./payment.js";`.
3. İstifadə yerində `#config` alias-ı ilə import et: `import { paymentConfig } from "#config";`.
