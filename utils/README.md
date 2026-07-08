# utils/

## Məqsəd

Bu qovluq tətbiqin müxtəlif yerlərində təkrarlanan kiçik, ümumi (stateless) köməkçi funksiyaları saxlayır. Bunlar konkret domenə bağlı deyil: `asyncHandler` async route handler-lərdəki səhvləri avtomatik tutub `next`-ə ötürərək təkrar `try/catch` bloklarını aradan qaldırır; `apiResponse` (`ok`, `fail`) isə bütün endpoint-lər üçün standart cavab zərfi (`{ success, message?, data?, errors? }`) qurur. Məqsəd kod təkrarını azaltmaq və cavab formatını vahid saxlamaqdır.

## Adlandırma / yazılış konvensiyası

Fayllar etdikləri işi bildirən `camelCase` adı daşıyır (məs. `asyncHandler.js`, `apiResponse.js`). Bir fayl bir və ya bir neçə əlaqəli sadə funksiya export edə bilər (məs. `apiResponse.js` həm `ok`, həm `fail` verir). Funksiyalar named export edilir və `index.js` barrel-ində yenidən açılır. Bu helper-lər state saxlamamalı və yan təsirsiz olmalıdır.

## Nümunə

`asyncHandler.js` async handler-i sarır:

```js
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export { asyncHandler };
```

`index.js` onu `export { asyncHandler } from "./asyncHandler.js";` ilə açır. Controller-lar `#utils` alias-ı ilə istifadə edir — məsələn `postController.js`-də `import { asyncHandler } from "#utils";` və `const listPosts = asyncHandler(async (req, res) => {...})`.

## Yeni fayl necə əlavə olunur

1. `<ad>.js` faylı yarat (məs. `slugify.js`).
2. Sadə, stateless funksiyanı yaz və named export et.
3. `index.js`-ə `export { slugify } from "./slugify.js";` əlavə et.
4. İstifadə yerində `#utils`-dan import et: `import { slugify } from "#utils";`.
