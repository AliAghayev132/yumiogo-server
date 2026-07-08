# constants

## Məqsəd

Bu qovluq tətbiq boyu təkrarlanan sabit dəyərləri — enum-ları, upload qovluq yollarını və Mongoose köməkçilərini — bir yerdə saxlayır. Belə dəyərlərin “magic string” kimi kod içində səpələnməsinin qarşısını alır: məsələn user rolları, account/post statusları, OTP tipləri, `uploads/` yolları, həmçinin `Schema` və `Model` kimi Mongoose qısaltmaları buradan gəlir. Modellər və controller-lər bu sabitləri import edərək eyni mənbədən istifadə edir.

## Adlandırma / yazılış konvensiyası

Faktiki sabitlər `shared/` alt-qovluğunda mövzuya görə fayllara bölünür: `enums.js` (siyahılar/enum-lar), `paths.js` (upload yolları), `variables.js` (`Schema`, `Model`, `Router`). Bu fayllar `shared/index.js` daxilində toplanır (`export * from "./enums.js";` və s.), ən üst səviyyədəki `index.js` isə yalnız `export * from "./shared/index.js";` edir. Hər dəyər adlandırılmış export kimi verilir və qovluq `#constants` alias-ı ilə import olunur.

## Nümunə

`shared/enums.js` faylından:

```js
const otpTypes = ["register", "reset-password", "verify-email"];
export { userRoles, accountStatus, postStatus, otpTypes };
```

Bu dəyər `shared/index.js` → `index.js` barrel zənciri ilə ixrac olunur və modeldə belə istifadə edilir: `import { Schema, Model, otpTypes } from "#constants";` → `type: { type: String, enum: otpTypes, default: "register" }`.

## Yeni fayl necə əlavə olunur

1. `shared/` içində uyğun mövzu faylı yarat və ya mövcuduna əlavə et (məs. `enums.js`-ə yeni siyahı) və named export ver: `export { notificationTypes }`.
2. Yeni fayl yaratdınsa, onu `shared/index.js` barrel-ə əlavə et: `export * from "./notifications.js";`.
3. İstifadə yerində `#constants` alias-ı ilə import et: `import { notificationTypes } from "#constants";`.
