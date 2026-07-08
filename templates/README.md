# templates/

## Məqsəd

Bu qovluq e-poçt (HTML) şablonlarını saxlayır. Hər şablon verilən parametrlərdən tam HTML string qaytaran sadə funksiyadır. Ümumi layout (`baseTemplate` — header brendi, content sahəsi, footer) bir dəfə təyin olunur, konkret məzmun şablonları (OTP, welcome) isə yalnız öz məzmununu doldurub bu baza layout-a ötürür. Bu sayədə bütün məktublar eyni görkəmi paylaşır və `MailService` yalnız hazır HTML-i alır.

## Adlandırma / yazılış konvensiyası

Fayllar `<name>Template.js` şəklində adlanır (məs. `otpTemplate.js`, `welcomeTemplate.js`, `baseTemplate.js`). Hər fayl adı ilə eyni olan bir named funksiya export edir (məs. `export const otpTemplate = (...) => {...}`). Məzmun şablonları `baseTemplate`-i import edib nəticəni onun içinə yerləşdirir. Bütün şablonlar `index.js` barrel-ində yenidən export edilir.

## Nümunə

`otpTemplate.js` OTP kodu üçün HTML qurur:

```js
import { baseTemplate } from "./baseTemplate.js";

export const otpTemplate = (title, message, code) => {
  const content = `
    <p>${message}</p>
    <div><span>${code}</span></div>
  `;
  return baseTemplate(title, content);
};
```

`index.js` onu `export { otpTemplate } from "./otpTemplate.js";` ilə açır. `MailService.js` isə `#templates` alias-ı ilə import edir: `import { otpTemplate } from "#templates";` və `html: otpTemplate(...)` kimi istifadə edir.

## Yeni fayl necə əlavə olunur

1. `<name>Template.js` faylı yarat (məs. `resetPasswordTemplate.js`).
2. `baseTemplate`-i import et, məzmunu HTML string kimi qur və `baseTemplate(title, content)` qaytar.
3. Fayl adı ilə eyni named funksiyanı export et.
4. `index.js`-ə `export { resetPasswordTemplate } from "./resetPasswordTemplate.js";` əlavə et.
5. `MailService`-də `#templates`-dan import edib istifadə et.
