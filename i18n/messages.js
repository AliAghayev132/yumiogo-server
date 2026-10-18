/**
 * Localized copy of the user-facing server messages, keyed by the stable
 * error `code` every error response carries. English stays whatever the
 * controller sent (it may be more specific); az / ru replace it when the
 * request asks for that language (Accept-Language) — see i18n/index.js.
 *
 * An entry is { az, ru } of strings, or of functions (body, locale) → string
 * for messages that need values from the response (retryAfter, attemptsLeft,
 * suspension date). `{name}` placeholders are filled from the response body.
 *
 * Deliberately NOT translated: MAINTENANCE (the admin writes that message)
 * and developer-only validation errors without a code.
 */

const date = (value, locale) => {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "az" ? "az-Latn-AZ" : "ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const ERROR_MESSAGES = {
  // ---------------------------------------------------------------- generic
  INVALID_ID: { az: "Yanlış identifikator", ru: "Неверный идентификатор" },
  INVALID_VALUE: { az: "Göndərilən dəyər düzgün deyil", ru: "Некорректное значение" },
  VALIDATION_ERROR: { az: "Göndərilən məlumatlar düzgün deyil", ru: "Отправленные данные некорректны" },
  INVALID_REQUEST: { az: "Sorğu məlumatları düzgün deyil", ru: "Некорректные данные запроса" },
  INVALID_QUERY: { az: "Axtarış parametrləri düzgün deyil", ru: "Некорректные параметры запроса" },
  DUPLICATE: { az: "Belə qeyd artıq mövcuddur", ru: "Такая запись уже существует" },
  BAD_JSON: { az: "Sorğunun formatı yanlışdır", ru: "Неверный формат запроса" },
  PAYLOAD_TOO_LARGE: { az: "Sorğu çox böyükdür", ru: "Слишком большой запрос" },
  SERVER_ERROR: {
    az: "Serverdə xəta baş verdi. Bir az sonra yenidən cəhd edin",
    ru: "Ошибка сервера. Попробуйте позже",
  },
  ENDPOINT_NOT_FOUND: { az: "Belə sorğu mövcud deyil", ru: "Такого запроса не существует" },
  NOT_FOUND: { az: "Tapılmadı", ru: "Не найдено" },
  FORBIDDEN: { az: "Bu əməliyyat üçün icazəniz yoxdur", ru: "У вас нет прав для этого действия" },
  RATE_LIMITED: {
    az: "Həddindən çox sorğu göndərildi. Bir az gözləyin",
    ru: "Слишком много запросов. Подождите немного",
  },
  LOGIN_LOCKED: {
    az: "Çox sayda uğursuz cəhd. 15 dəqiqə gözləyin.",
    ru: "Слишком много неудачных попыток. Подождите 15 минут.",
  },
  OTP_RATE_LIMITED: {
    az: "Həddindən çox təsdiq sorğusu. Bir neçə dəqiqə gözləyin.",
    ru: "Слишком много запросов подтверждения. Подождите несколько минут.",
  },
  DELETE_FAILED: { az: "Silmək alınmadı. Yenidən cəhd edin", ru: "Не удалось удалить. Попробуйте ещё раз" },
  NOT_CONFIGURED: { az: "Bu funksiya serverdə qurulmayıb", ru: "Эта функция не настроена на сервере" },
  APP_UPDATE_REQUIRED: {
    az: "Tətbiqin bu versiyası artıq dəstəklənmir. Davam etmək üçün Yumio-nu yeniləyin.",
    ru: "Эта версия приложения больше не поддерживается. Обновите Yumio, чтобы продолжить.",
  },

  // ------------------------------------------------------------ session
  AUTH_REQUIRED: { az: "Davam etmək üçün daxil olun", ru: "Войдите, чтобы продолжить" },
  TOKEN_EXPIRED: { az: "Sessiyanın vaxtı bitib", ru: "Сессия истекла" },
  TOKEN_INVALID: { az: "Sessiya etibarsızdır. Yenidən daxil olun", ru: "Недействительная сессия. Войдите снова" },
  SESSION_EXPIRED: { az: "Sessiyanın vaxtı bitib, yenidən daxil olun", ru: "Сессия истекла, войдите снова" },
  REFRESH_TOKEN_REQUIRED: { az: "Sessiyanın vaxtı bitib, yenidən daxil olun", ru: "Сессия истекла, войдите снова" },
  REFRESH_TOKEN_INVALID: { az: "Sessiyanın vaxtı bitib, yenidən daxil olun", ru: "Сессия истекла, войдите снова" },
  REFRESH_TOKEN_REUSED: {
    az: "Bu sessiya başqa yerdə istifadə olunub. Yenidən daxil olun.",
    ru: "Эта сессия использовалась в другом месте. Войдите снова.",
  },
  RESET_TOKEN_REQUIRED: {
    az: "Bərpa sessiyasının vaxtı bitib. Yeni kod istəyin",
    ru: "Срок сброса пароля истёк. Запросите новый код",
  },
  RESET_TOKEN_INVALID: {
    az: "Bərpa sessiyasının vaxtı bitib. Yeni kod istəyin",
    ru: "Срок сброса пароля истёк. Запросите новый код",
  },

  // ------------------------------------------------------------ account
  ACCOUNT_INACTIVE: { az: "Hesabınız aktiv deyil", ru: "Ваш аккаунт неактивен" },
  ACCOUNT_PENDING: {
    az: "Hesabınız təsdiq gözləyir. Admin təsdiqlədikdən sonra sizə xəbər verəcəyik.",
    ru: "Ваш аккаунт ожидает подтверждения. Мы сообщим вам, как только администратор его одобрит.",
  },
  ACCOUNT_SUSPENDED: {
    az: (body) => {
      const until = date(body?.data?.until, "az");
      return until ? `Hesabınız ${until} tarixinədək dayandırılıb.` : "Hesabınız dayandırılıb.";
    },
    ru: (body) => {
      const until = date(body?.data?.until, "ru");
      return until ? `Ваш аккаунт приостановлен до ${until}.` : "Ваш аккаунт приостановлен.";
    },
  },
  ACCOUNT_BANNED: { az: "Hesabınız bloklanıb.", ru: "Ваш аккаунт заблокирован." },
  ADMIN_ACCOUNT: {
    az: "Admin hesabları yalnız admin paneldən silinə bilər",
    ru: "Аккаунты администраторов удаляются только в админ-панели",
  },
  USER_NOT_FOUND: { az: "İstifadəçi tapılmadı", ru: "Пользователь не найден" },

  // ------------------------------------------------------ sign-up / login
  EMAIL_INVALID: { az: "Düzgün e-poçt ünvanı daxil edin", ru: "Введите корректный адрес электронной почты" },
  EMAIL_TAKEN: {
    az: "Bu e-poçt artıq qeydiyyatdan keçib",
    ru: "Этот адрес электронной почты уже зарегистрирован",
  },
  EMAIL_TAKEN_GOOGLE: {
    az: "Bu e-poçt Google ilə qeydiyyatdan keçib. Google ilə davam edin",
    ru: "Этот адрес зарегистрирован через Google. Продолжите с Google",
  },
  FIRST_NAME_INVALID: { az: "Adınızı düzgün daxil edin", ru: "Введите корректное имя" },
  LAST_NAME_INVALID: { az: "Soyadınızı düzgün daxil edin", ru: "Введите корректную фамилию" },
  PHONE_INVALID: { az: "Düzgün telefon nömrəsi daxil edin", ru: "Введите корректный номер телефона" },
  TERMS_REQUIRED: {
    az: "Davam etmək üçün Məxfilik Siyasətini qəbul edin",
    ru: "Чтобы продолжить, примите Политику конфиденциальности",
  },
  CREDENTIALS_REQUIRED: {
    az: "E-poçt və şifrəni daxil edin",
    ru: "Введите адрес электронной почты и пароль",
  },
  INVALID_CREDENTIALS: {
    az: "E-poçt və ya şifrə yanlışdır",
    ru: "Неверный адрес электронной почты или пароль",
  },
  USE_GOOGLE: {
    az: "Bu hesab Google ilə daxil olur. Google ilə davam edin və ya şifrənizi bərpa edin",
    ru: "Этот аккаунт использует вход через Google. Продолжите с Google или восстановите пароль",
  },
  GOOGLE_NOT_CONFIGURED: { az: "Google ilə giriş hələ mümkün deyil", ru: "Вход через Google пока недоступен" },
  GOOGLE_TOKEN_REQUIRED: {
    az: "Google ilə giriş alınmadı. Yenidən cəhd edin",
    ru: "Не удалось войти через Google. Попробуйте ещё раз",
  },
  GOOGLE_TOKEN_INVALID: {
    az: "Google ilə giriş alınmadı. Yenidən cəhd edin",
    ru: "Не удалось войти через Google. Попробуйте ещё раз",
  },
  GOOGLE_EMAIL_UNVERIFIED: {
    az: "Google bu e-poçt ünvanını təsdiqləməyib. E-poçtla qeydiyyatdan keçin",
    ru: "Google не подтвердил этот адрес электронной почты. Зарегистрируйтесь по электронной почте",
  },

  // ---------------------------------------------------------- passwords
  PASSWORD_REQUIRED: { az: "Şifrənizi daxil edin", ru: "Введите пароль" },
  PASSWORD_TOO_LONG: { az: "Şifrə çox uzundur", ru: "Пароль слишком длинный" },
  PASSWORD_WEAK: {
    az: "Şifrə ən azı 6 simvoldan ibarət olmalı, 1 böyük hərf və 1 rəqəm və ya xüsusi simvol daxil etməlidir",
    ru: "Пароль должен содержать не менее 6 символов, 1 заглавную букву и 1 цифру или специальный символ",
  },
  PASSWORD_REUSED: {
    az: "Yeni şifrə hazırkı şifrədən fərqli olmalıdır",
    ru: "Новый пароль должен отличаться от текущего",
  },
  PASSWORD_INVALID: { az: "Şifrə yanlışdır", ru: "Неверный пароль" },
  CURRENT_PASSWORD_REQUIRED: { az: "Hazırkı şifrənizi daxil edin", ru: "Введите текущий пароль" },
  CURRENT_PASSWORD_INVALID: { az: "Hazırkı şifrə yanlışdır", ru: "Текущий пароль неверен" },
  REAUTH_REQUIRED: {
    az: "Təhlükəsizlik üçün yenidən daxil olun və təkrar cəhd edin",
    ru: "В целях безопасности войдите снова и повторите попытку",
  },
  CONFIRM_REQUIRED: {
    az: "Hesabınızı silmək istədiyinizi təsdiqləyin",
    ru: "Подтвердите, что хотите удалить аккаунт",
  },

  // -------------------------------------------------------- verification
  OTP_REQUIRED: {
    az: "E-poçt və təsdiq kodunu daxil edin",
    ru: "Введите адрес электронной почты и код подтверждения",
  },
  OTP_NOT_FOUND: {
    az: "Kod tapılmadı və ya vaxtı bitib. Yeni kod istəyin",
    ru: "Код не найден или истёк. Запросите новый код",
  },
  OTP_EXPIRED: { az: "Kodun vaxtı bitib. Yeni kod istəyin", ru: "Срок действия кода истёк. Запросите новый код" },
  OTP_INVALID: {
    az: (body) =>
      Number(body?.attemptsLeft) > 0
        ? `Təsdiq kodu yanlışdır. ${body.attemptsLeft} cəhdiniz qalıb`
        : "Təsdiq kodu yanlışdır",
    ru: (body) =>
      Number(body?.attemptsLeft) > 0
        ? `Неверный код подтверждения. Осталось попыток: ${body.attemptsLeft}`
        : "Неверный код подтверждения",
  },
  OTP_TOO_MANY_ATTEMPTS: {
    az: "Çox sayda yanlış cəhd. Yeni kod istəyin",
    ru: "Слишком много неверных попыток. Запросите новый код",
  },
  OTP_LOCKED: {
    az: "Çox sayda yanlış kod daxil edildi. Bir az sonra yenidən cəhd edin",
    ru: "Слишком много неверных кодов. Попробуйте позже",
  },
  OTP_COOLDOWN: {
    az: (body) =>
      Number(body?.retryAfter) > 0
        ? `Yeni kod istəməzdən əvvəl ${body.retryAfter} saniyə gözləyin`
        : "Yeni kod istəməzdən əvvəl bir az gözləyin",
    ru: (body) =>
      Number(body?.retryAfter) > 0
        ? `Подождите ${body.retryAfter} с, прежде чем запросить новый код`
        : "Подождите немного, прежде чем запросить новый код",
  },
  OTP_SEND_LIMIT: {
    az: "Həddindən çox kod istənilib. Bir az sonra yenidən cəhd edin",
    ru: "Запрошено слишком много кодов. Попробуйте позже",
  },
  MAIL_NOT_CONFIGURED: {
    az: "E-poçt xidməti müvəqqəti əlçatan deyil. Bir az sonra yenidən cəhd edin",
    ru: "Почтовый сервис временно недоступен. Попробуйте позже",
  },
  MAIL_SEND_FAILED: { az: "E-poçt göndərilmədi. Yenidən cəhd edin", ru: "Не удалось отправить письмо. Попробуйте ещё раз" },

  // ------------------------------------------------------------- profile
  BIO_TOO_LONG: { az: "Bio ən çoxu 160 simvol ola bilər", ru: "Описание может содержать не более 160 символов" },
  CITY_INVALID: { az: "Belə şəhər tapılmadı", ru: "Такой город не найден" },
  LANGUAGE_INVALID: { az: "Bu dil dəstəklənmir", ru: "Этот язык не поддерживается" },
  SETTINGS_INVALID: { az: "Ayarlar düzgün deyil", ru: "Некорректные настройки" },
  PREFERENCES_INVALID: {
    az: "Seçimlərinizdən bəziləri artıq mövcud deyil",
    ru: "Некоторые из выбранных вариантов больше недоступны",
  },
  AVATAR_REQUIRED: { az: "Şəkil seçin", ru: "Выберите фото" },
  AVATAR_TYPE: {
    az: "Profil şəkli JPG, PNG, WEBP və ya GIF formatında olmalıdır",
    ru: "Фото профиля должно быть в формате JPG, PNG, WEBP или GIF",
  },
  AVATAR_INVALID: { az: "Profil şəklini yadda saxlamaq alınmadı", ru: "Не удалось сохранить фото профиля" },

  // ------------------------------------------------------------- social
  FOLLOW_SELF: { az: "Özünüzü izləyə bilməzsiniz", ru: "Нельзя подписаться на самого себя" },
  FOLLOW_REQUEST_NOT_FOUND: { az: "İzləmə sorğusu tapılmadı", ru: "Запрос на подписку не найден" },
  INVITE_NOT_FOUND: { az: "Dəvət tapılmadı", ru: "Приглашение не найдено" },
  INVITE_OWN: { az: "Bu sizin öz dəvətinizdir", ru: "Это ваше собственное приглашение" },
  INVITE_USED: { az: "Siz artıq dəvətdən istifadə etmisiniz", ru: "Вы уже использовали приглашение" },
  INVITE_EXPIRED: {
    az: "Dəvətlərdən yalnız yeni hesablar istifadə edə bilər",
    ru: "Приглашения доступны только для новых аккаунтов",
  },
  USER_IDS_INVALID: { az: "1–20 nəfər seçin", ru: "Выберите от 1 до 20 человек" },
  USER_INVALID: { az: "Yanlış istifadəçi", ru: "Неверный пользователь" },
  CONTACTS_EMPTY: { az: "Yoxlamaq üçün kontakt göndərin", ru: "Отправьте контакты для поиска" },
  CONTACTS_TOO_MANY: {
    az: "Bir sorğuda həddindən çox kontakt var",
    ru: "Слишком много контактов в одном запросе",
  },
  SHARE_TARGET_INVALID: {
    az: "Ya restoranı, ya da siyahını paylaşın",
    ru: "Поделитесь либо рестораном, либо списком",
  },
  SHARE_DISABLED: {
    az: "Tətbiq daxilində göndərmək artıq mümkün deyil. Linki paylaşın",
    ru: "Отправка внутри приложения больше недоступна. Поделитесь ссылкой",
  },
  PUSH_TOKEN_INVALID: { az: "Bildiriş tokeni yanlışdır", ru: "Неверный токен уведомлений" },
  IDS_INVALID: { az: "Yanlış bildiriş seçimi", ru: "Неверный выбор уведомлений" },

  // -------------------------------------------------------------- lists
  LIST_NOT_FOUND: { az: "Siyahı tapılmadı", ru: "Список не найден" },
  LIST_FORBIDDEN: { az: "Bu siyahını redaktə edə bilməzsiniz", ru: "Вы не можете редактировать этот список" },
  LIST_PRIVATE: { az: "Bu siyahı gizlidir", ru: "Это закрытый список" },
  LIST_OWN: { az: "Bu sizin öz siyahınızdır", ru: "Это ваш собственный список" },
  LIST_NAME_INVALID: { az: "Siyahının adını düzgün daxil edin", ru: "Введите корректное название списка" },
  LIST_PRIVACY_INVALID: { az: "Yanlış məxfilik seçimi", ru: "Неверный параметр конфиденциальности" },
  COLLABORATOR_NOT_FOUND: { az: "Bu istifadəçi siyahıda yoxdur", ru: "Этого пользователя нет в списке" },
  ROLE_INVALID: { az: "Yanlış rol seçimi", ru: "Неверная роль" },
  LIST_IDS_INVALID: { az: "Siyahı seçimi düzgün deyil", ru: "Некорректный выбор списков" },

  // ------------------------------------------- restaurants / reviews / reports
  RESTAURANT_NOT_FOUND: { az: "Restoran tapılmadı", ru: "Ресторан не найден" },
  RESTAURANT_INVALID: { az: "Yanlış restoran", ru: "Неверный ресторан" },
  REVIEW_NOT_FOUND: { az: "Rəy tapılmadı", ru: "Отзыв не найден" },
  REVIEW_TOO_LONG: { az: "Rəy ən çoxu 500 simvol ola bilər", ru: "Отзыв может содержать не более 500 символов" },
  // One new review per restaurant per 24 h (retryAfter = seconds).
  REVIEW_TOO_SOON: {
    az: (body) => {
      const hours = Math.ceil(Number(body?.retryAfter) / 3600);
      return hours > 0
        ? `Bu restorana son 24 saatda artıq rəy yazmısınız. O rəyi redaktə edə və ya ${hours} saat sonra yeni rəy yaza bilərsiniz`
        : "Bu restorana son 24 saatda artıq rəy yazmısınız. O rəyi redaktə edə və ya bir az sonra yeni rəy yaza bilərsiniz";
    },
    ru: (body) => {
      const hours = Math.ceil(Number(body?.retryAfter) / 3600);
      return hours > 0
        ? `Вы уже оставили отзыв об этом ресторане за последние 24 часа. Отредактируйте его или напишите новый через ${hours} ч`
        : "Вы уже оставили отзыв об этом ресторане за последние 24 часа. Отредактируйте его или напишите новый позже";
    },
  },
  COMMENT_NOT_FOUND: { az: "Şərh tapılmadı", ru: "Комментарий не найден" },
  COMMENT_REQUIRED: { az: "Şərhinizi yazın", ru: "Напишите комментарий" },
  COMMENT_TOO_LONG: {
    az: "Şərh ən çoxu 500 simvol ola bilər",
    ru: "Комментарий может содержать не более 500 символов",
  },
  COMMENT_PARENT_GONE: {
    az: "Cavab verdiyiniz şərh artıq mövcud deyil",
    ru: "Комментарий, на который вы отвечаете, больше не существует",
  },
  LABEL_EXISTS: { az: "Bu etiket artıq mövcuddur", ru: "Такая метка уже существует" },
  LABEL_ALREADY_SUGGESTED: { az: "Siz bu etiketi artıq təklif etmisiniz", ru: "Вы уже предложили эту метку" },
  LABEL_REQUESTS_PENDING: {
    az: "Əvvəlki təklifləriniz yoxlanılana qədər gözləyin",
    ru: "Подождите, пока ваши предыдущие предложения рассмотрят",
  },
  REPORT_OWN: { az: "Öz məzmununuzdan şikayət edə bilməzsiniz", ru: "Нельзя пожаловаться на свой собственный контент" },
  REPORT_REASON_REQUIRED: { az: "Siyahıdan səbəb seçin", ru: "Выберите причину из списка" },
  REPORT_RATE_LIMITED: {
    az: "Həddindən çox şikayət göndərildi. Bir az sonra yenidən cəhd edin.",
    ru: "Слишком много жалоб. Попробуйте позже.",
  },
  REPORT_DUPLICATE: {
    az: "Siz artıq bu barədə şikayət etmisiniz. Biz məşğul oluruq.",
    ru: "Вы уже отправили жалобу. Мы уже разбираемся.",
  },

  // ------------------------------------------------------------ uploads
  FILES_REQUIRED: { az: "Fayl seçin", ru: "Выберите файл" },
  TOO_MANY_FILES: { az: "Bir dəfəyə ən çoxu 8 fayl yükləmək olar", ru: "За один раз можно загрузить не более 8 файлов" },
  FILE_TOO_LARGE: { az: "Fayl çox böyükdür (ən çoxu 10 MB)", ru: "Файл слишком большой (не более 10 МБ)" },
  FILE_TYPE_NOT_ALLOWED: {
    az: "Yalnız JPG, PNG, WEBP və ya GIF şəkillər yükləmək olar",
    ru: "Можно загружать только изображения JPG, PNG, WEBP или GIF",
  },
  FILE_INVALID: { az: "Faylı yükləmək alınmadı", ru: "Не удалось загрузить файл" },
  UPLOAD_KIND_INVALID: { az: "Yükləmə növü yanlışdır", ru: "Неверный тип загрузки" },
  UPLOAD_QUOTA: {
    az: "Bu gün çox şəkil yükləmisiniz. Sabah yenidən cəhd edin.",
    ru: "Сегодня вы загрузили слишком много фото. Попробуйте завтра.",
  },

  // -------------------------------------------------------- admin tools
  TRANSLATE_NOT_CONFIGURED: {
    az: "Süni intellektlə tərcümə serverdə qurulmayıb",
    ru: "Перевод с помощью ИИ не настроен на сервере",
  },
  TRANSLATE_FAILED: {
    az: "Tərcümə alınmadı. Bir az sonra yenidən cəhd edin",
    ru: "Не удалось перевести. Попробуйте ещё раз чуть позже",
  },
  TRANSLATE_INVALID: { az: "Tərcümə sorğusu düzgün deyil", ru: "Некорректный запрос на перевод" },
  IMPORT_INVALID: { az: "İdxal faylı düzgün deyil", ru: "Некорректный файл импорта" },
};

/**
 * E-mail copy (OTP / welcome / new follower) per language. English is the
 * source; `{name}` placeholders are filled by the templates.
 */
const EMAIL_COPY = {
  en: {
    otpTitle: { register: "Verify your email", "reset-password": "Reset your password", "verify-email": "Verify your email" },
    otpMessage: {
      register: "Enter this code in the app to finish creating your account:",
      "reset-password": "Enter this code in the app to reset your password:",
      "verify-email": "Enter this code in the app to verify your email address:",
    },
    otpValidity: "This code is valid for <strong>{minutes} minutes</strong>.",
    otpIgnore: "If you did not request this, please ignore this email.",
    welcomeSubject: "Welcome to {app}!",
    welcomeTitle: "Welcome",
    welcomeHeading: "Welcome{name}!",
    welcomeBody:
      "Your account has been created. Discover the best places to eat around you, save your favourites and see where your friends go.",
    welcomeCta: "Start exploring",
    welcomeFooter: "If you have any questions, just reply to this email.",
    followerSubject: "{actor} started following you on {app}",
    followerTitle: "New follower",
    followerGreeting: "Hi{name},",
    followerHeading: "{actor} started following you.",
    followerCta: "Open Yumio",
    followerFooter: "You can turn these emails off in Settings → Email Notification.",
  },
  az: {
    otpTitle: {
      register: "E-poçtunuzu təsdiqləyin",
      "reset-password": "Şifrənizi bərpa edin",
      "verify-email": "E-poçtunuzu təsdiqləyin",
    },
    otpMessage: {
      register: "Hesabınızın yaradılmasını tamamlamaq üçün bu kodu tətbiqə daxil edin:",
      "reset-password": "Şifrənizi bərpa etmək üçün bu kodu tətbiqə daxil edin:",
      "verify-email": "E-poçt ünvanınızı təsdiqləmək üçün bu kodu tətbiqə daxil edin:",
    },
    otpValidity: "Bu kod <strong>{minutes} dəqiqə</strong> etibarlıdır.",
    otpIgnore: "Bu sorğunu siz göndərməmisinizsə, məktubu nəzərə almayın.",
    welcomeSubject: "{app}-ya xoş gəlmisiniz!",
    welcomeTitle: "Xoş gəlmisiniz",
    welcomeHeading: "Xoş gəlmisiniz{name}!",
    welcomeBody:
      "Hesabınız yaradıldı. Ətrafınızdakı ən yaxşı məkanları kəşf edin, sevimlilərinizi yadda saxlayın və dostlarınızın harada yemək yediyini görün.",
    welcomeCta: "Kəşf etməyə başla",
    welcomeFooter: "Sualınız varsa, sadəcə bu məktuba cavab yazın.",
    followerSubject: "{actor} sizi {app}-da izləməyə başladı",
    followerTitle: "Yeni izləyici",
    followerGreeting: "Salam{name},",
    followerHeading: "{actor} sizi izləməyə başladı.",
    followerCta: "Yumio-nu aç",
    followerFooter: "Bu məktubları Ayarlar → E-poçt bildirişləri bölməsində söndürə bilərsiniz.",
  },
  ru: {
    otpTitle: {
      register: "Подтвердите адрес электронной почты",
      "reset-password": "Сброс пароля",
      "verify-email": "Подтвердите адрес электронной почты",
    },
    otpMessage: {
      register: "Введите этот код в приложении, чтобы завершить создание аккаунта:",
      "reset-password": "Введите этот код в приложении, чтобы сбросить пароль:",
      "verify-email": "Введите этот код в приложении, чтобы подтвердить адрес электронной почты:",
    },
    otpValidity: "Код действителен в течение <strong>{minutes} мин.</strong>",
    otpIgnore: "Если вы не запрашивали код, просто проигнорируйте это письмо.",
    welcomeSubject: "Добро пожаловать в {app}!",
    welcomeTitle: "Добро пожаловать",
    welcomeHeading: "Добро пожаловать{name}!",
    welcomeBody:
      "Ваш аккаунт создан. Открывайте лучшие места поблизости, сохраняйте любимые и смотрите, куда ходят ваши друзья.",
    welcomeCta: "Начать",
    welcomeFooter: "Если у вас есть вопросы, просто ответьте на это письмо.",
    followerSubject: "Новый подписчик в {app}: {actor}",
    followerTitle: "Новый подписчик",
    followerGreeting: "Здравствуйте{name},",
    followerHeading: "{actor} теперь следит за вами.",
    followerCta: "Открыть Yumio",
    followerFooter: "Эти письма можно отключить в разделе Настройки → Уведомления по почте.",
  },
};

/**
 * Notification copy (Profile → Notifications and push) per language.
 *
 * Activity sentences leave out the actor's name — the app puts it in front
 * ("Leyla Aliyeva started following you."), so they start lower-case. A
 * restaurant name is inserted through `quote` («Nero Bistro» in az / ru,
 * which keeps Azerbaijani suffixes off the name).
 *
 * `system` entries are the moderation notices, stored with a stable key in
 * `data.i18n = { key, values }` and rendered at read / push time in the
 * reader's language (the English text is also stored as the fallback).
 * `{name}` placeholders come from `values`; `messageUntil` replaces
 * `message` when `values.until` is set, and `reason` / `note` are appended
 * when those values are present. `targets` / `someRestaurant` stand in for a
 * missing name.
 */
const NOTIFICATION_COPY = {
  en: {
    quote: "{name}",
    follow: "started following you.",
    followSuggestionContact: "from your contacts joined Yumio. Follow them back?",
    followSuggestionInvite: "joined Yumio with your invite. Follow them back?",
    followRequest: "requested to follow you.",
    followAccept: "accepted your follow request.",
    listSave: "added your favourites list to their collection.",
    listVisit: "visited {restaurant} — a place on your list.",
    listVisitAny: "visited a place on your list.",
    reviewLike: "liked your review of {restaurant}.",
    reviewLikeAny: "liked your review.",
    comment: "commented on your review of {restaurant}.",
    commentAny: "commented on your review.",
    reply: "replied to your comment.",
    mention: "mentioned you in a comment.",
    reviewTag: "tagged you in their review of {restaurant}.",
    reviewTagAny: "tagged you in their review.",
    commentLike: "liked your comment.",
    member: "A Yumio member",
    shareList: 'shared the list "{list}" with you.',
    shareRestaurant: "shared {restaurant} with you.",
    shareAny: "shared something with you.",
    collaboratorInvite: 'added you to the list "{list}".',
    collaboratorInviteAny: "added you to a list.",
    offerPercent: "{percent}% off",
    offerAny: "a new discount",
    restaurantOffer: "{restaurant} now has {offer}.",
    restaurantOfferAny: "A restaurant you follow now has {offer}.",
    restaurantMenu: "{restaurant} added new dishes to the menu.",
    restaurantMenuAny: "A restaurant you follow added new dishes.",
    someRestaurant: "a restaurant",
    targets: { review: "a review", user: "a user", restaurant: "a restaurant", list: "a list", comment: "a comment" },
    system: {
      account_banned: {
        title: "Your account has been banned",
        message: "Your Yumio account has been banned.",
        reason: " Reason: {reason}",
      },
      account_suspended: {
        title: "Your account has been suspended",
        message: "Your Yumio account has been suspended.",
        messageUntil: "Your Yumio account is suspended until {until}.",
        reason: " Reason: {reason}",
      },
      account_restored: {
        title: "Your account has been restored",
        message: "Your Yumio account is active again. Welcome back!",
      },
      account_approved: {
        title: "Your account has been approved",
        message: "Your Yumio account has been approved. You can now sign in.",
      },
      suspension_ended: { title: "Your suspension has ended", message: "Your Yumio account is active again." },
      warning: { title: "You received a warning", message: "The Yumio team issued you a warning: {reason}" },
      restaurant_active: { title: "Restaurant listing update", message: "{restaurant} is now live on Yumio." },
      restaurant_rejected: {
        title: "Restaurant listing update",
        message: "{restaurant} was not approved.",
        reason: " Reason: {reason}",
      },
      restaurant_suspended: {
        title: "Restaurant listing update",
        message: "{restaurant} has been suspended.",
        reason: " Reason: {reason}",
      },
      list_removed: {
        title: "List removed",
        message: 'Your list "{list}" was removed by a moderator.',
        reason: " Reason: {reason}",
      },
      review_approved: { title: "Review approved", message: "Your review of {restaurant} was approved and is now public." },
      review_flagged: {
        title: "Review flagged",
        message: "Your review of {restaurant} was flagged and is being checked by our team.",
      },
      review_rejected: {
        title: "Review not published",
        message: "Your review of {restaurant} was not published.",
        reason: " Reason: {reason}",
      },
      review_hidden: {
        title: "Review hidden",
        message: "Your review of {restaurant} was hidden.",
        reason: " Reason: {reason}",
      },
      review_removed: {
        title: "Review removed",
        message: "Your review of {restaurant} was removed.",
        reason: " Reason: {reason}",
      },
      report_resolved: {
        title: "Report reviewed",
        message: "Your report about {about} was reviewed and action was taken.",
        note: " Note from our team: {note}",
      },
      report_dismissed: {
        title: "Report reviewed",
        message: "Your report about {about} was reviewed. No action was taken.",
        note: " Note from our team: {note}",
      },
      label_added: { title: "Label added", message: 'Your label idea "{label}" is now available to everyone. Thanks!' },
      label_rejected: { title: "Label idea reviewed", message: 'Your label idea "{label}" was not added.', note: " {note}" },
    },
  },
  az: {
    quote: "«{name}»",
    follow: "sizi izləməyə başladı.",
    followSuggestionContact: "(kontaktlarınızdan) Yumio-ya qoşuldu. Qarşılıqlı izləmək istəyirsiniz?",
    followSuggestionInvite: "dəvətinizlə Yumio-ya qoşuldu. Qarşılıqlı izləmək istəyirsiniz?",
    followRequest: "sizi izləmək istəyir.",
    followAccept: "izləmə istəyinizi qəbul etdi.",
    listSave: "sevimlilər siyahınızı öz kolleksiyasına əlavə etdi.",
    listVisit: "siyahınızdakı {restaurant} məkanına baş çəkdi.",
    listVisitAny: "siyahınızdakı məkanlardan birinə baş çəkdi.",
    reviewLike: "{restaurant} haqqında rəyinizi bəyəndi.",
    reviewLikeAny: "rəyinizi bəyəndi.",
    comment: "{restaurant} haqqında rəyinizə şərh yazdı.",
    commentAny: "rəyinizə şərh yazdı.",
    reply: "şərhinizə cavab verdi.",
    mention: "şərhdə sizi qeyd etdi.",
    reviewTag: "{restaurant} haqqında rəyində sizi qeyd etdi.",
    reviewTagAny: "rəyində sizi qeyd etdi.",
    commentLike: "şərhinizi bəyəndi.",
    member: "Yumio istifadəçisi",
    shareList: "sizinlə «{list}» siyahısını paylaşdı.",
    shareRestaurant: "sizinlə {restaurant} məkanını paylaşdı.",
    shareAny: "sizinlə nəsə paylaşdı.",
    collaboratorInvite: "sizi «{list}» siyahısına əlavə etdi.",
    collaboratorInviteAny: "sizi siyahıya əlavə etdi.",
    offerPercent: "{percent}% endirim",
    offerAny: "yeni endirim",
    restaurantOffer: "{restaurant} məkanında indi {offer} var.",
    restaurantOfferAny: "İzlədiyiniz restoranda indi {offer} var.",
    restaurantMenu: "{restaurant} menyuya yeni yeməklər əlavə etdi.",
    restaurantMenuAny: "İzlədiyiniz restoran menyuya yeni yeməklər əlavə etdi.",
    someRestaurant: "bir restoran",
    targets: { review: "rəy", user: "istifadəçi", restaurant: "restoran", list: "siyahı", comment: "şərh" },
    system: {
      account_banned: {
        title: "Hesabınız bloklandı",
        message: "Yumio hesabınız bloklandı.",
        reason: " Səbəb: {reason}",
      },
      account_suspended: {
        title: "Hesabınız dayandırıldı",
        message: "Yumio hesabınız dayandırıldı.",
        messageUntil: "Yumio hesabınız {until} tarixinədək dayandırılıb.",
        reason: " Səbəb: {reason}",
      },
      account_restored: {
        title: "Hesabınız bərpa olundu",
        message: "Yumio hesabınız yenidən aktivdir. Yenidən xoş gəlmisiniz!",
      },
      account_approved: {
        title: "Hesabınız təsdiqləndi",
        message: "Yumio hesabınız təsdiqləndi. İndi daxil ola bilərsiniz.",
      },
      suspension_ended: { title: "Hesabın dayandırılması başa çatdı", message: "Yumio hesabınız yenidən aktivdir." },
      warning: { title: "Sizə xəbərdarlıq edildi", message: "Yumio komandası sizə xəbərdarlıq etdi: {reason}" },
      restaurant_active: { title: "Restoran elanı yeniləndi", message: "{restaurant} artıq Yumio-da dərc olunub." },
      restaurant_rejected: {
        title: "Restoran elanı yeniləndi",
        message: "{restaurant} təsdiqlənmədi.",
        reason: " Səbəb: {reason}",
      },
      restaurant_suspended: {
        title: "Restoran elanı yeniləndi",
        message: "{restaurant} dayandırıldı.",
        reason: " Səbəb: {reason}",
      },
      list_removed: {
        title: "Siyahı silindi",
        message: "«{list}» siyahınız moderator tərəfindən silindi.",
        reason: " Səbəb: {reason}",
      },
      review_approved: { title: "Rəy təsdiqləndi", message: "{restaurant} haqqında rəyiniz təsdiqləndi və artıq hamıya görünür." },
      review_flagged: {
        title: "Rəy yoxlamaya göndərildi",
        message: "{restaurant} haqqında rəyiniz işarələndi və komandamız tərəfindən yoxlanılır.",
      },
      review_rejected: {
        title: "Rəy dərc olunmadı",
        message: "{restaurant} haqqında rəyiniz dərc olunmadı.",
        reason: " Səbəb: {reason}",
      },
      review_hidden: {
        title: "Rəy gizlədildi",
        message: "{restaurant} haqqında rəyiniz gizlədildi.",
        reason: " Səbəb: {reason}",
      },
      review_removed: {
        title: "Rəy silindi",
        message: "{restaurant} haqqında rəyiniz silindi.",
        reason: " Səbəb: {reason}",
      },
      report_resolved: {
        title: "Şikayət nəzərdən keçirildi",
        message: "{about} ilə bağlı şikayətiniz nəzərdən keçirildi və tədbir görüldü.",
        note: " Komandamızın qeydi: {note}",
      },
      report_dismissed: {
        title: "Şikayət nəzərdən keçirildi",
        message: "{about} ilə bağlı şikayətiniz nəzərdən keçirildi. Heç bir tədbir görülmədi.",
        note: " Komandamızın qeydi: {note}",
      },
      label_added: { title: "Etiket əlavə olundu", message: "«{label}» etiket təklifiniz artıq hamı üçün əlçatandır. Təşəkkür edirik!" },
      label_rejected: { title: "Etiket təklifi nəzərdən keçirildi", message: "«{label}» etiket təklifiniz əlavə olunmadı.", note: " {note}" },
    },
  },
  ru: {
    quote: "«{name}»",
    follow: "теперь следит за вами.",
    followSuggestionContact: "из ваших контактов теперь в Yumio. Подписаться в ответ?",
    followSuggestionInvite: "теперь в Yumio по вашему приглашению. Подписаться в ответ?",
    followRequest: "хочет подписаться на вас.",
    followAccept: "принял(а) ваш запрос на подписку.",
    listSave: "добавил(а) ваш список избранного в свою коллекцию.",
    listVisit: "побывал(а) в {restaurant} — это место есть в вашем списке.",
    listVisitAny: "побывал(а) в месте из вашего списка.",
    reviewLike: "оценил(а) ваш отзыв о {restaurant}.",
    reviewLikeAny: "оценил(а) ваш отзыв.",
    comment: "прокомментировал(а) ваш отзыв о {restaurant}.",
    commentAny: "прокомментировал(а) ваш отзыв.",
    reply: "ответил(а) на ваш комментарий.",
    mention: "упомянул(а) вас в комментарии.",
    reviewTag: "отметил(а) вас в своём отзыве о {restaurant}.",
    reviewTagAny: "отметил(а) вас в своём отзыве.",
    commentLike: "оценил(а) ваш комментарий.",
    member: "Участник Yumio",
    shareList: "поделился(-ась) с вами списком «{list}».",
    shareRestaurant: "поделился(-ась) с вами местом {restaurant}.",
    shareAny: "чем-то поделился(-ась) с вами.",
    collaboratorInvite: "добавил(а) вас в список «{list}».",
    collaboratorInviteAny: "добавил(а) вас в список.",
    offerPercent: "скидка {percent}%",
    offerAny: "новая скидка",
    restaurantOffer: "В {restaurant} теперь {offer}.",
    restaurantOfferAny: "В ресторане, на который вы подписаны, теперь {offer}.",
    restaurantMenu: "В меню {restaurant} появились новые блюда.",
    restaurantMenuAny: "В меню ресторана, на который вы подписаны, появились новые блюда.",
    someRestaurant: "ресторане",
    targets: { review: "отзыв", user: "пользователя", restaurant: "ресторан", list: "список", comment: "комментарий" },
    system: {
      account_banned: {
        title: "Ваш аккаунт заблокирован",
        message: "Ваш аккаунт Yumio заблокирован.",
        reason: " Причина: {reason}",
      },
      account_suspended: {
        title: "Ваш аккаунт приостановлен",
        message: "Ваш аккаунт Yumio приостановлен.",
        messageUntil: "Ваш аккаунт Yumio приостановлен до {until}.",
        reason: " Причина: {reason}",
      },
      account_restored: {
        title: "Ваш аккаунт восстановлен",
        message: "Ваш аккаунт Yumio снова активен. С возвращением!",
      },
      account_approved: {
        title: "Ваш аккаунт одобрен",
        message: "Ваш аккаунт Yumio одобрен. Теперь вы можете войти.",
      },
      suspension_ended: { title: "Приостановка аккаунта завершена", message: "Ваш аккаунт Yumio снова активен." },
      warning: { title: "Вы получили предупреждение", message: "Команда Yumio вынесла вам предупреждение: {reason}" },
      restaurant_active: { title: "Обновление по ресторану", message: "Ресторан {restaurant} теперь опубликован в Yumio." },
      restaurant_rejected: {
        title: "Обновление по ресторану",
        message: "Ресторан {restaurant} не прошёл проверку.",
        reason: " Причина: {reason}",
      },
      restaurant_suspended: {
        title: "Обновление по ресторану",
        message: "Публикация {restaurant} приостановлена.",
        reason: " Причина: {reason}",
      },
      list_removed: {
        title: "Список удалён",
        message: "Модератор удалил ваш список «{list}».",
        reason: " Причина: {reason}",
      },
      review_approved: { title: "Отзыв одобрен", message: "Ваш отзыв о {restaurant} одобрен и теперь виден всем." },
      review_flagged: {
        title: "Отзыв на проверке",
        message: "Ваш отзыв о {restaurant} отмечен и проверяется нашей командой.",
      },
      review_rejected: {
        title: "Отзыв не опубликован",
        message: "Ваш отзыв о {restaurant} не опубликован.",
        reason: " Причина: {reason}",
      },
      review_hidden: {
        title: "Отзыв скрыт",
        message: "Ваш отзыв о {restaurant} скрыт.",
        reason: " Причина: {reason}",
      },
      review_removed: {
        title: "Отзыв удалён",
        message: "Ваш отзыв о {restaurant} удалён.",
        reason: " Причина: {reason}",
      },
      report_resolved: {
        title: "Жалоба рассмотрена",
        message: "Ваша жалоба на {about} рассмотрена, меры приняты.",
        note: " Комментарий нашей команды: {note}",
      },
      report_dismissed: {
        title: "Жалоба рассмотрена",
        message: "Ваша жалоба на {about} рассмотрена. Меры не потребовались.",
        note: " Комментарий нашей команды: {note}",
      },
      label_added: { title: "Метка добавлена", message: "Предложенная вами метка «{label}» теперь доступна всем. Спасибо!" },
      label_rejected: { title: "Предложение метки рассмотрено", message: "Предложенная вами метка «{label}» не добавлена.", note: " {note}" },
    },
  },
};

export { ERROR_MESSAGES, EMAIL_COPY, NOTIFICATION_COPY };
