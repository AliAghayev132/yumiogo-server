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
    az: "Profil şəkli JPG, PNG, WEBP, GIF və ya HEIC formatında olmalıdır",
    ru: "Фото профиля должно быть в формате JPG, PNG, WEBP, GIF или HEIC",
  },
  AVATAR_INVALID: { az: "Profil şəklini yadda saxlamaq alınmadı", ru: "Не удалось сохранить фото профиля" },

  // ------------------------------------------------------------- social
  FOLLOW_SELF: { az: "Özünüzü izləyə bilməzsiniz", ru: "Нельзя подписаться на самого себя" },
  INVITE_NOT_FOUND: { az: "Dəvət tapılmadı", ru: "Приглашение не найдено" },
  INVITE_OWN: { az: "Bu sizin öz dəvətinizdir", ru: "Это ваше собственное приглашение" },
  INVITE_USED: { az: "Siz artıq dəvətdən istifadə etmisiniz", ru: "Вы уже использовали приглашение" },
  INVITE_EXPIRED: {
    az: "Dəvətlərdən yalnız yeni hesablar istifadə edə bilər",
    ru: "Приглашения доступны только для новых аккаунтов",
  },
  USER_IDS_INVALID: { az: "1–20 nəfər seçin", ru: "Выберите от 1 до 20 человек" },

  // -------------------------------------------------------------- lists
  LIST_NOT_FOUND: { az: "Siyahı tapılmadı", ru: "Список не найден" },
  LIST_FORBIDDEN: { az: "Bu siyahını redaktə edə bilməzsiniz", ru: "Вы не можете редактировать этот список" },
  LIST_PRIVATE: { az: "Bu siyahı gizlidir", ru: "Это закрытый список" },
  LIST_OWN: { az: "Bu sizin öz siyahınızdır", ru: "Это ваш собственный список" },
  LIST_NAME_INVALID: { az: "Siyahının adını düzgün daxil edin", ru: "Введите корректное название списка" },
  LIST_PRIVACY_INVALID: { az: "Yanlış məxfilik seçimi", ru: "Неверный параметр конфиденциальности" },
  COLLABORATOR_NOT_FOUND: { az: "Bu istifadəçi siyahıda yoxdur", ru: "Этого пользователя нет в списке" },

  // ------------------------------------------- restaurants / reviews / reports
  RESTAURANT_NOT_FOUND: { az: "Restoran tapılmadı", ru: "Ресторан не найден" },
  REVIEW_NOT_FOUND: { az: "Rəy tapılmadı", ru: "Отзыв не найден" },
  REVIEW_TOO_LONG: { az: "Rəy ən çoxu 500 simvol ola bilər", ru: "Отзыв может содержать не более 500 символов" },
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
  UPLOAD_QUOTA: {
    az: "Bu gün çox şəkil yükləmisiniz. Sabah yenidən cəhd edin.",
    ru: "Сегодня вы загрузили слишком много фото. Попробуйте завтра.",
  },
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

export { ERROR_MESSAGES, EMAIL_COPY };
