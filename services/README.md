# services/

## Məqsəd

Bu qovluq tətbiqin yenidən istifadə oluna bilən biznes/infrastruktur məntiqini controller-lərdən ayıran servis təbəqəsini saxlayır. Parol hash-lənməsi (`HashService`), token idarəetməsi (`AuthTokenService`), şifrələmə (`EncryptionService`), fayl əməliyyatları (`FileService`), e-poçt göndərilməsi (`MailService`), MongoDB bağlantısı (`MongoDBService`), real-time socket (`SocketService`) və başlanğıc admin qurulması (`BootstrapService`) burada cəmlənib. Controller-lar yalnız bu servisləri çağırır, aşağı səviyyəli detalları bilmir.

## Adlandırma / yazılış konvensiyası

Fayllar `PascalCase` + `Service` suffiksi ilə adlanır (məs. `HashService.js`, `MailService.js`). Servislər iki üslubdadır: state saxlamayanlar `static` metodlu class kimi yazılıb named export edilir (məs. `export { HashService }`), state/singleton lazım olanlar isə class instansı kimi default export edilir (məs. `SocketService`). Hər servis `index.js` barrel-ində uyğun formada yenidən export olunur.

## Nümunə

`HashService.js` static class-dır:

```js
import { bcrypt } from "#lib";

class HashService {
  static saltRounds = 12;
  static async hashPassword(password) {
    return bcrypt.hash(password, this.saltRounds);
  }
}

export { HashService };
```

`index.js` onu `export { HashService } from "./HashService.js";` ilə açır. Digər yerlərdə `#services` alias-ı ilə istifadə olunur — məsələn `BootstrapService.js` daxilində `import { HashService } from "#services";`.

## Yeni fayl necə əlavə olunur

1. `XService.js` faylı yarat (məs. `NotificationService.js`).
2. State yoxdursa `static` metodlu class yaz və named export et; singleton lazımdırsa instans yaradıb default export et.
3. `index.js`-ə uyğun sətri əlavə et: named üçün `export { NotificationService } from "./NotificationService.js";`, default üçün `export { default as notificationService } from "./NotificationService.js";`.
4. İstifadə yerində `#services`-dən import et.
