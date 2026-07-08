# scripts/

## Məqsəd

Bu qovluq tətbiqin normal iş axını (HTTP server, router-lar) xaricində, birdəfəlik və ya vaxtaşırı əl ilə işə salınan köməkçi (utility/maintenance) skriptlərini saxlayır. Məsələn: bazanın sıfırlanması, seed məlumatının doldurulması, miqrasiya. Bu skriptlər developer/DevOps tərəfindən terminal-dan icra olunur, request-response dövrəsinin bir hissəsi deyil.

## Adlandırma / yazılış konvensiyası

Fayllar icra etdikləri əməliyyatı təsvir edən `camelCase` fel/isim adı ilə adlanır (məs. `resetDatabase.js`). **Bu qovluqda `index.js` barrel YOXDUR** — skriptlər başqa modul tərəfindən import edilmək üçün nəzərdə tutulmayıb, birbaşa `node` ilə işə salınır. Hər skript öz `main` funksiyasını təyin edir və faylın sonunda dərhal çağırır, iş bitdikdə `process.exit()` ilə prosesi bağlayır. Lazım olan servis və modelları `#services`, `#models` alias-ları ilə import edir.

## Nümunə

`resetDatabase.js` bütün kolleksiyaları təmizləyir:

```js
import { mongoDBService } from "#services";
import { User, OTP, Post } from "#models";

const resetDatabase = async () => {
  await mongoDBService.connect();
  const models = [User, OTP, Post];
  for (const model of models) await model.deleteMany({});
  await mongoDBService.disconnect();
  process.exit(0);
};

resetDatabase();
```

Barrel olmadığı üçün birbaşa işə salınır:

```bash
node scripts/resetDatabase.js
```

## Yeni fayl necə əlavə olunur

1. `<əməliyyat>.js` faylı yarat (məs. `seedUsers.js`).
2. Lazımi servisləri/modelları `#services`, `#models` ilə import et.
3. Bir `async` funksiya yaz, DB bağlantısını aç/bağla, sonda `process.exit()` çağır.
4. Faylın sonunda funksiyanı çağır (`seedUsers();`).
5. `node scripts/seedUsers.js` ilə işə sal. `index.js`-ə heç nə əlavə etmə.
