# lib

## Məqsəd

Bu qovluq xarici asılılıqlar (npm paketləri) və Node.js built-in modulları üçün vahid giriş nöqtəsidir. Bütün üçüncü tərəf importları burada bir dəfə toplanır ki, kodun qalan hissəsi `express`, `mongoose`, `jsonwebtoken`, `bcryptjs`, `helmet` və s. paketləri birbaşa deyil, `#lib` alias-ı vasitəsilə alsın. Bu yanaşma asılılıqların idarəsini asanlaşdırır: paket dəyişdirilərsə və ya wrap edilərsə, yalnız bir fayla toxunmaq kifayət edir.

## Adlandırma / yazılış konvensiyası

Bütün re-export-lar tək `index.js` faylında yazılır. Default export-lu paketlər `export { default as <ad> } from "<paket>";` formasında adlandırılmış export-a çevrilir (məs. `jwt`, `mongoose`, `bcrypt`). Bir paketdən əlavə named export lazımdırsa, eyni sətirdə əlavə olunur (məs. `export { default as express, Router as ExpressRouter } from "express";`). Node built-in-ləri isə `node:` prefiksi ilə yazılır (`node:http`, `node:crypto`).

## Nümunə

`index.js` faylından:

```js
export { default as jwt } from "jsonwebtoken";
export { default as mongoose } from "mongoose";
export { default as express, Router as ExpressRouter } from "express";
```

Bu ixraclar `#lib` alias-ı ilə istifadə olunur, məsələn middleware-də: `import { jwt } from "#lib";` → `const decoded = jwt.verify(token, config.accessSecretKey);`.

## Yeni fayl necə əlavə olunur

Bu qovluqda adətən yeni fayl yaradılmır — hər şey vahid `index.js` barrel-ində saxlanır. Yeni asılılıq əlavə etmək üçün:

1. Paketi quraşdır (məs. `pnpm add dayjs`).
2. `index.js`-ə re-export sətri əlavə et: `export { default as dayjs } from "dayjs";`.
3. İstifadə yerində `#lib` alias-ı ilə import et: `import { dayjs } from "#lib";`.
