/**
 * Azerbaijani and Russian versions of the catalog defaults (catalogDefaults.js).
 *
 * CatalogService.fillDefaultTranslations() copies these into the stored
 * `translations` of the default taxonomies, cities, FAQs, onboarding slides,
 * legal pages and Settings — but only into an az / ru field that is empty and
 * only while the English text is still the shipped default, so admin edits
 * are never overwritten. Lookups are keyed by the English default text (or by
 * slug / Settings key + the English text), so an edited English text simply
 * gets no default translation.
 *
 * Markdown links and `{appLinks.*}` / `{maxDiscount}` placeholders are kept
 * verbatim. Intentionally NOT re-exported from the #constants barrel.
 */

const tr = (az, ru) => ({ az, ru });

// ----- Taxonomies: English name → { az, ru }, per type -----
const TAXONOMY_TRANSLATIONS = {
  cuisine: {
    International: tr("Beynəlxalq", "Интернациональная"),
    Turkish: tr("Türk", "Турецкая"),
    Chinese: tr("Çin", "Китайская"),
    "Fast Food": tr("Fast food", "Фастфуд"),
    Seafood: tr("Dəniz məhsulları", "Морепродукты"),
    Italian: tr("İtalyan", "Итальянская"),
    Japanese: tr("Yapon", "Японская"),
    Azerbaijani: tr("Azərbaycan", "Азербайджанская"),
    Indian: tr("Hind", "Индийская"),
    Cafe: tr("Kafe", "Кафе"),
    Vegan: tr("Vegan", "Веганская"),
    Steakhouse: tr("Steyk-haus", "Стейк-хаус"),
    Georgian: tr("Gürcü", "Грузинская"),
    Mediterranean: tr("Aralıq dənizi", "Средиземноморская"),
    Pizza: tr("Pizza", "Пицца"),
    Sushi: tr("Suşi", "Суши"),
    Burger: tr("Burger", "Бургеры"),
    Barbecue: tr("Manqal", "Барбекю"),
    Cheeseburger: tr("Çizburger", "Чизбургеры"),
    Crepes: tr("Krep", "Блинчики"),
    Asian: tr("Asiya", "Азиатская"),
    Healthy: tr("Sağlam qida", "Здоровое питание"),
    Desserts: tr("Desertlər", "Десерты"),
  },
  feature: {
    "Accepts Credit Cards": tr("Kartla ödəniş", "Оплата картой"),
    Seating: tr("Oturacaq yerləri", "Места для сидения"),
    Reservations: tr("Rezervasiya", "Бронирование"),
    Takeout: tr("Özünlə götür", "Еда навынос"),
    Delivery: tr("Çatdırılma", "Доставка"),
    Parking: tr("Parkinq", "Парковка"),
    Wifi: tr("Wi-Fi", "Wi-Fi"),
    "Outdoor Seating": tr("Açıq havada oturacaq", "Столики на улице"),
  },
  tag: {
    "Local dishes": tr("Yerli yeməklər", "Местная кухня"),
    Trendy: tr("Trenddə", "В тренде"),
    Halal: tr("Halal", "Халяль"),
    "Vegan options": tr("Vegan seçimlər", "Веганские блюда"),
  },
  dietary: {
    Vegetarian: tr("Vegetarian", "Вегетарианское"),
    "Gluten free": tr("Qlütensiz", "Без глютена"),
    Vegan: tr("Vegan", "Веганское"),
    Halal: tr("Halal", "Халяль"),
    Organic: tr("Orqanik", "Органическое"),
    "Dairy-free": tr("Süd məhsulsuz", "Без молочных продуктов"),
  },
  mood: {
    "With friends": tr("Dostlarla", "С друзьями"),
    Family: tr("Ailəvi", "Всей семьёй"),
    Romantic: tr("Romantik", "Романтика"),
    Trendy: tr("Trenddə", "В тренде"),
    Quiet: tr("Sakit məkan", "Тихое место"),
  },
  reportReason: {
    "Spam / advertising": tr("Spam / reklam", "Спам / реклама"),
    "Offensive language": tr("Təhqiramiz ifadələr", "Оскорбительные выражения"),
    "Incorrect information": tr("Yanlış məlumat", "Неверная информация"),
    "Closed permanently": tr("Həmişəlik bağlanıb", "Закрыто навсегда"),
    "Fake account": tr("Saxta hesab", "Фейковый аккаунт"),
    "Not a real visit": tr("Real ziyarət olmayıb", "Не было реального визита"),
    "Fake review": tr("Saxta rəy", "Фейковый отзыв"),
    "Spam account": tr("Spam hesab", "Спам-аккаунт"),
    Inappropriate: tr("Yolverilməz məzmun", "Неприемлемый контент"),
  },
  reviewLabel: {
    // "Good for"
    Atmosphere: tr("Atmosfer", "Атмосфера"),
    "Bottomless Brunch": tr("Limitsiz branç", "Безлимитный бранч"),
    "Cash only": tr("Yalnız nağd", "Только наличные"),
    "Casual dinner": tr("Sadə şam yeməyi", "Неформальный ужин"),
    "Cheap eats": tr("Ucuz yeməklər", "Недорогая еда"),
    Cocktails: tr("Kokteyllər", "Коктейли"),
    Coffee: tr("Qəhvə", "Кофе"),
    Dessert: tr("Desert", "Десерт"),
    "Good for dates": tr("Görüş üçün", "Для свиданий"),
    "Family friendly": tr("Ailə üçün uyğun", "Для всей семьи"),
    "Business lunch": tr("Biznes-lanç", "Бизнес-ланч"),
    "Great view": tr("Gözəl mənzərə", "Красивый вид"),
    // "What was wrong?"
    "Bad Ambiance": tr("Pis atmosfer", "Плохая атмосфера"),
    "Bad Food": tr("Dadsız yemək", "Невкусная еда"),
    "Bad music": tr("Pis musiqi", "Плохая музыка"),
    "Bad service": tr("Pis xidmət", "Плохое обслуживание"),
    Expensive: tr("Bahalı", "Дорого"),
    "Hard to reserve": tr("Rezerv etmək çətindir", "Трудно забронировать"),
    "Limited options": tr("Seçim azdır", "Мало выбора"),
    "Limited seating": tr("Yer azdır", "Мало мест"),
    "Long wait": tr("Uzun gözləmə", "Долгое ожидание"),
    Noisy: tr("Səs-küylü", "Шумно"),
  },
  dining: {
    Breakfast: tr("Səhər yeməyi", "Завтрак"),
    Dessert: tr("Desert", "Десерт"),
    Lunch: tr("Nahar", "Обед"),
    Dinner: tr("Şam yeməyi", "Ужин"),
    Brunch: tr("Branç", "Бранч"),
    Seating: tr("Oturacaq yerləri", "Места для сидения"),
    Catering: tr("Keyterinq", "Кейтеринг"),
  },
};

// Review-label section headings (Taxonomy.group).
const TAXONOMY_GROUP_TRANSLATIONS = {
  "Good for": tr("Nə üçün uyğundur", "Подходит для"),
  "What was wrong?": tr("Nəyi bəyənmədiniz?", "Что было не так?"),
};

// ----- Cities (name; label = "<name>, <country>") -----
const CITY_TRANSLATIONS = {
  Baku: tr("Bakı", "Баку"),
  Ganja: tr("Gəncə", "Гянджа"),
  Sumqayit: tr("Sumqayıt", "Сумгайыт"),
  Shaki: tr("Şəki", "Шеки"),
  Quba: tr("Quba", "Губа"),
  Lankaran: tr("Lənkəran", "Ленкорань"),
  Shamakhi: tr("Şamaxı", "Шамахы"),
  Naxchivan: tr("Naxçıvan", "Нахчыван"),
};
const COUNTRY_TRANSLATIONS = {
  Azerbaijan: tr("Azərbaycan", "Азербайджан"),
};

// ----- FAQ: English question → { question, answer } -----
const FAQ_TRANSLATIONS = {
  "How do ratings work?": {
    question: tr("Reytinqlər necə işləyir?", "Как работают оценки?"),
    answer: tr(
      "Ulduz əvəzinə ziyarətinizi reaksiya ilə qiymətləndirirsiniz — «Bəyəndim», «Normal idi» və ya «Bəyənmədim». Hamının reaksiyalarını birləşdirərək restoranın ümumi balını çıxarırıq.",
      "Вместо звёзд вы оцениваете визит реакцией — «Понравилось», «Нормально» или «Не понравилось». Из реакций всех гостей складывается общая оценка ресторана.",
    ),
  },
  "How do I save a restaurant?": {
    question: tr("Restoranı necə yadda saxlaya bilərəm?", "Как сохранить ресторан?"),
    answer: tr(
      "İstənilən restoran kartında və ya səhifəsində ürək işarəsinə toxunun. Restoran şəxsi «Yadda saxlanılanlar» siyahınıza düşəcək — həmçinin öz siyahılarınızı yaradıb dostlarınızla paylaşa bilərsiniz.",
      "Нажмите на сердечко на карточке или странице ресторана. Он попадёт в ваш личный список «Сохранённое» — а ещё вы можете создавать собственные списки и делиться ими с друзьями.",
    ),
  },
  "What are collaborative lists?": {
    question: tr("Birgə siyahılar nədir?", "Что такое совместные списки?"),
    answer: tr(
      "Birgə siyahını onu paylaşdığınız hər kəs redaktə edə bilər — dostlarla şam yeməyi planlaşdırmaq üçün ideal seçimdir. Siyahının məxfilik ayarını istənilən vaxt dəyişə bilərsiniz.",
      "Совместный список может редактировать любой, с кем вы им поделились, — идеально для планирования ужинов с друзьями. Настройки приватности списка можно изменить в любое время.",
    ),
  },
  "How does Surprise me work?": {
    question: tr("«Məni təəccübləndir» necə işləyir?", "Как работает «Удиви меня»?"),
    answer: tr(
      "«Məni təəccübləndir» olduğunuz əraziyə əsasən yaxınlığınızda açıq olan təsadüfi bir restoran seçir. Seçimi bəyənmədiniz? Yenidən cəhd edin — təklifləri təkrarlamayacağıq.",
      "«Удиви меня» выбирает случайный открытый ресторан рядом с вами, в вашем районе. Не понравился вариант? Попробуйте ещё раз — мы не будем повторяться.",
    ),
  },
  "How do I change my password?": {
    question: tr("Şifrəmi necə dəyişə bilərəm?", "Как сменить пароль?"),
    answer: tr(
      "Profil → Şəxsi məlumatlar → Şifrəni dəyiş bölməsinə keçin. Şifrənizi unutmusunuzsa, giriş ekranında «Şifrəni unutmusunuz?» düyməsindən istifadə edin.",
      "Откройте Профиль → Личные данные → Сменить пароль. Если вы забыли пароль, нажмите «Забыли пароль?» на экране входа.",
    ),
  },
  "What is Yumio?": {
    question: tr("Yumio nədir?", "Что такое Yumio?"),
    answer: tr(
      "Yumio ətrafınızdakı ən yaxşı yemək məkanlarını tapmaq üçün restoran kəşf tətbiqidir — xəritə, real qonaqların dürüst reaksiyaları və izlədiyiniz dostların tövsiyələri ilə.",
      "Yumio — приложение для поиска ресторанов, которое помогает находить лучшие места рядом с вами: с картой, честными реакциями реальных гостей и рекомендациями друзей, на которых вы подписаны.",
    ),
  },
  "Is Yumio free?": {
    question: tr("Yumio pulsuzdur?", "Yumio бесплатный?"),
    answer: tr(
      "Bəli — restoranları kəşf etmək, rəy yazmaq və siyahılar yaratmaq tamamilə pulsuzdur.",
      "Да — поиск ресторанов, отзывы и списки полностью бесплатны.",
    ),
  },
};

// ----- Onboarding slides: English title → { title, subtitle } -----
const ONBOARDING_TRANSLATIONS = {
  "Discover your next favourite restaurant": {
    title: tr("Növbəti sevimli restoranınızı kəşf edin", "Откройте свой новый любимый ресторан"),
    subtitle: tr(
      "Ətrafınızdakı ən yaxşı məkanları tapın — gizli incilərdən hamının sevdiyi yerlərə qədər, hamısı bir yerdə.",
      "Находите лучшие места рядом — от скрытых жемчужин до всеобщих любимцев, всё в одном месте.",
    ),
  },
  "Save the places you love": {
    title: tr("Sevdiyiniz məkanları yadda saxlayın", "Сохраняйте любимые места"),
    subtitle: tr(
      "Öz siyahılarınızı yaradın, sevimlilərinizi qaydaya salın və ən yaxşı qastronomik təcrübələrinizə istənilən vaxt qayıdın.",
      "Создавайте свои списки, упорядочивайте избранное и возвращайтесь к лучшим гастрономическим впечатлениям в любое время.",
    ),
  },
  "Share lists with friends & family": {
    title: tr("Siyahıları dostlarınız və ailənizlə paylaşın", "Делитесь списками с друзьями и близкими"),
    subtitle: tr(
      "Birlikdə yemək planlaşdırın, sevimli məkanlarınızı paylaşın və etibar etdiyiniz insanların nə tövsiyə etdiyini kəşf edin.",
      "Планируйте встречи за едой вместе, делитесь любимыми местами и узнавайте, что советуют люди, которым вы доверяете.",
    ),
  },
};

// ----- Legal pages: slug → { title, sections (same order as DEFAULT_PAGES) } -----
const section = (heading, body) => ({ heading, body });

const PAGE_TRANSLATIONS = {
  terms: {
    title: tr("İstifadə şərtləri", "Условия использования"),
    sections: [
      section(
        tr("1. Yumio haqqında", "1. О Yumio"),
        tr(
          "Yumio ətrafınızdakı restoranları və məkanları kəşf etməyə, dürüst rəyləri oxuyub paylaşmağa və dostlarınızla birlikdə ziyarətlər planlaşdırmağa kömək edir. Tətbiqdən istifadə etməklə bu şərtlərlə razılaşırsınız.",
          "Yumio помогает находить рестораны и заведения рядом с вами, читать и публиковать честные отзывы и планировать походы с друзьями. Пользуясь приложением, вы соглашаетесь с этими условиями.",
        ),
      ),
      section(
        tr("2. Hesabınız", "2. Ваш аккаунт"),
        tr(
          "Giriş məlumatlarınızın təhlükəsizliyinə siz cavabdehsiniz. Yumio-dan istifadə etmək üçün düzgün məlumat təqdim etməli və ən azı 13 yaşınız olmalıdır.",
          "Вы несёте ответственность за сохранность своих учётных данных. Чтобы пользоваться Yumio, нужно указывать достоверную информацию и быть не младше 13 лет.",
        ),
      ),
      section(
        tr("3. Rəylər və istifadəçi məzmunu", "3. Отзывы и пользовательский контент"),
        tr(
          "Rəylər real təcrübənizi əks etdirməlidir. Spam, reklam, təhqiramiz ifadələr və saxta rəylər silinir və hesabın dayandırılmasına səbəb ola bilər. Məzmun dərc etməklə Yumio-ya onu tətbiqdə göstərmək üçün lisenziya verirsiniz.",
          "Отзывы должны отражать ваш реальный опыт. Спам, реклама, оскорбительные выражения и фейковые отзывы удаляются и могут привести к блокировке аккаунта. Публикуя контент, вы предоставляете Yumio лицензию на его показ в приложении.",
        ),
      ),
      section(
        tr("4. Restoran məlumatları", "4. Информация о ресторанах"),
        tr(
          "Reytinqlər istifadəçi reaksiyalarından toplanır. İş saatları, qiymətlər və menyular restoranlar və ya icma tərəfindən təqdim olunur və xəbərdarlıq edilmədən dəyişə bilər.",
          "Рейтинги складываются из реакций пользователей. Часы работы, цены и меню предоставляются ресторанами или сообществом и могут меняться без предупреждения.",
        ),
      ),
      section(
        tr("5. Hesabın dayandırılması", "5. Прекращение доступа"),
        tr(
          "Bu şərtləri pozan hesabları dayandıra bilərik. Dəstək xidməti ilə əlaqə saxlayaraq hesabınızı istənilən vaxt silə bilərsiniz.",
          "Мы можем заблокировать аккаунты, нарушающие эти условия. Вы можете удалить свой аккаунт в любое время, обратившись в службу поддержки.",
        ),
      ),
    ],
  },
  privacy: {
    title: tr("Məxfilik parametrləri", "Настройки конфиденциальности"),
    sections: [
      section(
        tr("İstifadə şərtləri", "Условия использования"),
        tr(
          "Yumio-dan istifadə etməklə bu şərtlərlə razılaşırsınız. Yumio sizə platformaya daxil olmaq və ondan şəxsi, qeyri-kommersiya məqsədləri üçün istifadə etmək üçün məhdud, eksklüziv olmayan və başqasına ötürülə bilməyən lisenziya verir.\n\nXidmətlərimizdən sui-istifadə etməməli, onlara təqdim olunan interfeysdən başqa üsullarla daxil olmağa cəhd etməməli və onlardan qanunsuz məqsədlər üçün istifadə etməməlisiniz.",
          "Пользуясь Yumio, вы соглашаетесь с этими условиями. Yumio предоставляет вам ограниченную неисключительную лицензию без права передачи на доступ к платформе и её использование в личных некоммерческих целях.\n\nЗапрещается злоупотреблять нашими сервисами, пытаться получить к ним доступ иначе, чем через предоставленный интерфейс, или использовать их в незаконных целях.",
        ),
      ),
      section(
        tr("Yumio nədir?", "Что такое Yumio?"),
        tr(
          "Yumio şəxsi zövqünüzə və əhvalınıza uyğun restoranları, kafeləri və yemək məkanlarını tapmağa kömək edən qastronomik kəşf platformasıdır.\n\nYumio restoran idarə etmir və rezervasiya qəbul etmir. Biz icmanın yaratdığı məzmun, rəylər və seçilmiş siyahılar vasitəsilə insanları məkanlarla birləşdiririk.\n\n> Yumio rezervasiya və ya çatdırılma xidməti deyil, kəşf alətidir. Məqsədimiz yemək üçün ideal məkanı tapmağınıza kömək etməkdir.",
          "Yumio — платформа гастрономических открытий, которая помогает находить рестораны, кафе и другие заведения по вашему вкусу и настроению.\n\nYumio не управляет ресторанами и не принимает бронирования. Мы знакомим людей с заведениями с помощью контента сообщества, отзывов и тематических списков.\n\n> Yumio — это сервис для поиска заведений, а не для бронирования или доставки. Наша цель — помочь вам найти идеальное место, где поесть.",
        ),
      ),
      section(
        tr("Rəylər və istifadəçi məzmunu", "Отзывы и пользовательский контент"),
        tr(
          "Rəy və ya siyahı göndərdikdə Yumio-ya həmin məzmundan platformada istifadə etmək, onu göstərmək və yaymaq üçün bütün dünyada qüvvədə olan, qonorarsız lisenziya verirsiniz.\n\nRəylərinizin düzgünlüyünə yalnız siz cavabdehsiniz. Yumio rəyləri yoxlamır, lakin icma qaydalarımızı pozan məzmunu silmək hüququnu özündə saxlayır.\n\n> Rəylər dürüst olmalı və real təcrübəyə əsaslanmalıdır. Saxta və ya mükafat qarşılığında yazılmış rəylər qəti qadağandır.",
          "Публикуя отзыв или список, вы предоставляете Yumio всемирную безвозмездную лицензию на использование, показ и распространение этого контента на платформе.\n\nВы несёте единоличную ответственность за достоверность своих отзывов. Yumio не проверяет отзывы, но оставляет за собой право удалять контент, нарушающий правила сообщества.\n\n> Отзывы должны быть честными и основываться на реальном опыте. Фейковые или оплаченные отзывы строго запрещены.",
        ),
      ),
      section(
        tr("Restoran reytinqləri", "Рейтинги ресторанов"),
        tr(
          "Yumio-dakı reytinqlər istifadəçi rəylərinin ümumiləşdirilməsi əsasında hesablanır. Heç bir restoran reytinqini dəyişmək və ya yaxşılaşdırmaq üçün pul ödəyə bilməz.\n\nReytinqlər yeni rəylər göndərildikcə real vaxtda yenilənir. Restoranın ümumi balı bütün təsdiqlənmiş istifadəçi qiymətlərinin ortalamasını əks etdirir.",
          "Рейтинги в Yumio рассчитываются на основе всех отзывов пользователей. Ни один ресторан не может заплатить за изменение или повышение своего рейтинга.\n\nРейтинги обновляются в реальном времени по мере появления новых отзывов. Общая оценка ресторана — это среднее значение всех подтверждённых оценок пользователей.",
        ),
      ),
      section(
        tr("Məlumatlarınız", "Ваши данные"),
        tr(
          "Şəxsi məlumatlarınızı üçüncü tərəflərə satmırıq.",
          "Мы не продаём ваши персональные данные третьим лицам.",
        ),
      ),
    ],
  },
  cookies: {
    title: tr("Kuki siyasəti", "Политика использования cookie"),
    sections: [
      section(
        tr("Kukilər nədir?", "Что такое cookie?"),
        tr(
          "Kukilər Yumio-dan istifadə etdiyiniz zaman cihazınızda saxlanılan kiçik mətn fayllarıdır. Onlar seçimlərinizi yadda saxlamağa, hesabınızdan çıxmamağınıza və platformamızdan necə istifadə etdiyinizi anlamağımıza kömək edir.\n\nYumio həm birinci tərəf kukilərindən (bizim qurduğumuz), həm də üçüncü tərəf kukilərindən (analitika xidmətləri kimi tərəfdaşların qurduğu) istifadə edir.",
          "Cookie — это небольшие текстовые файлы, которые сохраняются на вашем устройстве, когда вы пользуетесь Yumio. Они помогают нам запоминать ваши настройки, сохранять вход в аккаунт и понимать, как вы пользуетесь платформой.\n\nYumio использует как собственные cookie, так и сторонние (их устанавливают партнёры, например сервисы аналитики).",
        ),
      ),
      section(
        tr("Maraqlara əsaslanan reklam", "Реклама на основе интересов"),
        tr(
          "Yumio baxış vərdişlərinizə və yemək seçimlərinizə əsasən sizə uyğun məzmun göstərmək üçün kukilərdən istifadə edə bilər. Buna maraqlara əsaslanan və ya davranış reklamı deyilir.\n\nMaraqlara əsaslanan reklamdan istənilən vaxt cihaz parametrlərindən və ya kuki seçimləri panelimizdən imtina edə bilərsiniz.\n\n> Yumio şəxsi məlumatlarınızı reklamçılara satmır. Reklamlar yalnız tətbiqdaxili maraqlarınıza əsasən seçilir.",
          "Yumio может использовать cookie, чтобы показывать вам подходящий контент с учётом ваших действий и предпочтений в еде. Это называется рекламой на основе интересов, или поведенческой рекламой.\n\nОтказаться от рекламы на основе интересов можно в любой момент в настройках устройства или в панели настроек cookie.\n\n> Yumio не продаёт ваши персональные данные рекламодателям. Реклама подбирается только на основе ваших интересов в приложении.",
        ),
      ),
      section(
        tr("Kuki növləri", "Типы cookie"),
        tr(
          "| Növ | Məqsəd |\n|---|---|\n| Zəruri | Giriş, təhlükəsizlik, əsas funksiyalar |\n| Analitika | İstifadə statistikası, performans |\n| Seçimlər | Dil, mövzu, filtrlər |\n| Marketinq | Maraqlara əsaslanan məzmun |",
          "| Тип | Назначение |\n|---|---|\n| Необходимые | Вход, безопасность, основные функции |\n| Аналитические | Статистика использования, производительность |\n| Функциональные | Язык, тема, фильтры |\n| Маркетинговые | Контент на основе интересов |",
        ),
      ),
      section(
        tr("Mobil cihazlar", "Мобильные устройства"),
        tr(
          "Mobil cihazlarda kukilər fərqli işləyir. Yumio təcrübənizi fərdiləşdirmək üçün brauzer kukiləri əvəzinə cihaz identifikatorlarından (iOS-da IDFA, Android-də GAID) istifadə edir.\n\nReklam izləməsini birbaşa cihaz parametrlərindən sıfırlaya və ya məhdudlaşdıra bilərsiniz.",
          "На мобильных устройствах cookie работают иначе. Вместо cookie браузера Yumio использует идентификаторы устройства (IDFA на iOS, GAID на Android), чтобы персонализировать приложение для вас.\n\nСбросить или ограничить рекламное отслеживание можно прямо в настройках устройства.",
        ),
      ),
      section(
        tr("Yumio-nu yükləyin", "Скачайте Yumio"),
        tr(
          "Yumio-nu cihazınıza yükləyin və bütün kuki seçimlərini birbaşa tətbiqdə idarə edin.\n\n[Google Play]({appLinks.android}) [App Store]({appLinks.ios})",
          "Установите Yumio на своё устройство и управляйте всеми настройками cookie прямо в приложении.\n\n[Google Play]({appLinks.android}) [App Store]({appLinks.ios})",
        ),
      ),
    ],
  },
};

// ----- Settings -----
// Free-text settings (Settings.translations), keyed by field.
const SETTINGS_ROOT_TRANSLATIONS = {
  maintenanceMessage: tr(
    "Yumio-da bəzi təkmilləşdirmələr aparılır. Bir az sonra yenidən baxın.",
    "Мы немного улучшаем Yumio. Загляните чуть позже.",
  ),
  supportReplyNote: tr("Adətən bir gün ərzində cavab veririk.", "Обычно мы отвечаем в течение дня."),
  companyAddress: tr("Bakı, Azərbaycan", "Баку, Азербайджан"),
};

// Keyed lists: list → key → field → { az, ru } (tabLabels: arrays).
const MOST_SAVED_MONTH = {
  label: tr("Bu ay ən çox yadda saxlanılanlar", "Чаще всего сохраняли в этом месяце"),
  description: tr(
    "Son 30 gündə ən çox yadda saxlanılan restoranları göstərir.",
    "Показывает рестораны, которые чаще всего сохраняли за последние 30 дней.",
  ),
};
const ON_THE_RISE = {
  label: tr("Populyarlaşanlar", "Набирают популярность"),
  description: tr(
    "Yumio istifadəçiləri arasında sürətlə sevimliyə çevrilən restoranları kəşf edin.",
    "Узнайте, какие рестораны быстро становятся любимыми у пользователей Yumio.",
  ),
};
const TOP_RATED_MONTH_LABEL = tr("Bu ayın ən yüksək reytinqliləri", "Лучшие по оценкам за месяц");
const SEE_MORE = tr("Hamısına bax", "Все");
const SURPRISE_ME = tr("Məni təəccübləndir", "Удиви меня");

const SETTINGS_LIST_TRANSLATIONS = {
  sortOptions: {
    relevance: {
      label: tr("Uyğunluq", "По релевантности"),
      description: tr(
        "Uyğunluq sıralaması restoranları axtarışınıza və bir neçə meyara görə düzür: yazdığınıza nə dərəcədə uyğun gəlmələri, xüsusi təkliflər, orta reytinq, daxil etdiyiniz ünvana olan məsafə və hazırda Yumio-da nə qədər populyar olmaları.",
        "Сортировка по релевантности упорядочивает рестораны по вашему запросу и нескольким критериям: насколько они соответствуют введённому тексту, специальные предложения, средний рейтинг, расстояние до указанного адреса и то, насколько они популярны в Yumio прямо сейчас.",
      ),
    },
    rating: {
      label: tr("Orta reytinq", "Средний рейтинг"),
      description: tr(
        "Orta reytinq sıralaması restoranları qonaqların verdiyi orta qiymətə görə düzür — ən yüksək orta reytinqdən ən aşağıya doğru.",
        "Сортировка по среднему рейтингу упорядочивает рестораны по средней оценке гостей — от самой высокой к самой низкой.",
      ),
    },
    popularity: {
      label: tr("Populyarlıq", "Популярность"),
      description: tr(
        "Populyarlıq sıralaması restoranları son 7 gündə Yumio-da qonaqların onlara nə qədər baxdığına, onları nə qədər yadda saxladığına və rəy yazdığına görə düzür — ən populyardan ən az populyara doğru.",
        "Сортировка по популярности упорядочивает рестораны по тому, как часто гости просматривали, сохраняли и оценивали их в Yumio за последние 7 дней — от самого популярного к наименее популярному.",
      ),
    },
    top_rated_month: {
      label: TOP_RATED_MONTH_LABEL,
      description: tr(
        "Son 30 gündə qonaqların verdiyi orta qiymətə görə restoranları ən yüksək reytinqdən ən aşağıya doğru göstərir.",
        "Показывает рестораны от самого высокого рейтинга к самому низкому (по средней оценке гостей) за последние 30 дней.",
      ),
    },
    price_asc: {
      label: tr("Qiymət", "Цена"),
      description: tr(
        "Qiymət sıralaması restoranları ən ucuzdan ən bahalıya doğru düzür (restoran səhifəsində göstərilən orta qiymətə görə).",
        "Сортировка по цене упорядочивает рестораны от самых недорогих к самым дорогим (по среднему чеку, указанному на странице ресторана).",
      ),
    },
    newest: {
      label: tr("Yeni restoranlar", "Новые рестораны"),
      description: tr(
        "Yeni restoranlar sıralaması restoranları Yumio-da ilk dərc olunma tarixinə görə düzür — ən yenidən ən köhnəyə doğru.",
        "Сортировка «Новые рестораны» упорядочивает рестораны по дате первой публикации в Yumio — от самых новых к самым старым.",
      ),
    },
    trending_month: {
      label: tr("Bu ayın trendləri", "В тренде в этом месяце"),
      description: tr(
        "Restoranları son 30 gündə qonaqların onlara nə qədər baxdığına, onları nə qədər yadda saxladığına və rəy yazdığına görə düzür.",
        "Упорядочивает рестораны по тому, как часто гости просматривали, сохраняли и оценивали их за последние 30 дней.",
      ),
    },
    distance: {
      label: tr("Məsafə", "Расстояние"),
      description: tr(
        "Məsafə sıralaması restoranları daxil etdiyiniz ünvana ən yaxından ən uzağa doğru düzür.",
        "Сортировка по расстоянию упорядочивает рестораны от ближайшего к самому дальнему от указанного адреса.",
      ),
    },
    saved: {
      label: tr("Ən çox yadda saxlanılan", "Чаще всего сохраняют"),
      description: tr(
        "Restoranları qonaqların onları siyahılarına neçə dəfə əlavə etdiyinə görə düzür.",
        "Упорядочивает рестораны по тому, сколько гостей сохранили их в свои списки.",
      ),
    },
    price_desc: {
      label: tr("Qiymət: bahadan ucuza", "Цена: сначала дорогие"),
      description: tr(
        "Restoranları ən bahalıdan ən ucuza doğru düzür (restoran səhifəsində göstərilən orta qiymətə görə).",
        "Упорядочивает рестораны от самых дорогих к самым недорогим (по среднему чеку, указанному на странице ресторана).",
      ),
    },
    most_saved_month: MOST_SAVED_MONTH,
    on_the_rise: ON_THE_RISE,
  },
  trendingOptions: {
    most_saved_month: MOST_SAVED_MONTH,
    top_rated_month: {
      label: TOP_RATED_MONTH_LABEL,
      description: tr(
        "Son 30 gündə ən yüksək reytinqə malik restoranları göstərir.",
        "Показывает рестораны с самым высоким рейтингом за последние 30 дней.",
      ),
    },
    on_the_rise: ON_THE_RISE,
  },
  recommendations: {
    trending: {
      title: tr("Hazırda trenddə", "Сейчас в тренде"),
      description: tr(
        "Bu ay qonaqların ən çox baxdığı, yadda saxladığı və rəy yazdığı restoranlar.",
        "Рестораны, которые гости чаще всего просматривали, сохраняли и оценивали в этом месяце.",
      ),
    },
    bestRated: {
      title: tr("Ən yüksək reytinq", "Лучший рейтинг"),
      description: tr("Ən yüksək orta reytinqə malik restoranlar.", "Рестораны с самым высоким средним рейтингом."),
    },
    friendPicks: {
      title: tr("Dostların seçimi", "Выбор друзей"),
      description: tr(
        "İzlədiyiniz insanların yadda saxladığı və bəyəndiyi restoranlar.",
        "Рестораны, которые сохранили и оценили люди, на которых вы подписаны.",
      ),
    },
  },
  priceLevels: {
    $: { hint: tr("Büdcəli", "Бюджетно") },
    $$: { hint: tr("Orta", "Умеренно") },
    $$$: { hint: tr("Yüksək səviyyə", "Выше среднего") },
    $$$$: { hint: tr("Lüks restoran", "Высокая кухня") },
  },
  notificationOptions: {
    emailNotifications: {
      label: tr("Yeni izləyicilər barədə e-poçt al", "Получать письма о новых подписчиках"),
    },
    reservationAlerts: {
      label: tr("Rezervasiyalarım barədə məlumat al", "Получать информацию о моих бронированиях"),
    },
    followerAlerts: {
      label: tr("Yeni izləyicilər barədə bildiriş al", "Получать уведомления о новых подписчиках"),
      description: tr(
        "Rezervasiyalarınız, sevimli restoranlarınızın yenilikləri, aksiyalar, izləyicilər və Yumio-dan digər xəbərlər barədə push bildirişləri alın.",
        "Получайте push-уведомления о бронированиях, новостях любимых ресторанов, акциях, подписчиках и других новостях Yumio.",
      ),
    },
    pushNotifications: {
      label: tr("Push bildirişləri al", "Получать push-уведомления"),
    },
  },
  sentiments: {
    liked: { label: tr("Bəyəndim", "Понравилось") },
    fine: { label: tr("Normal idi", "Нормально") },
    disliked: { label: tr("Bəyənmədim", "Не понравилось") },
  },
  homeSections: {
    cuisines: { title: tr("Mətbəxlər", "Кухни") },
    nearYou: { title: tr("Yaxınlığınızda", "Рядом с вами") },
    discounted: {
      title: tr("{maxDiscount}%-dək endirim", "Скидки до {maxDiscount}%"),
      ctaLabel: SEE_MORE,
    },
    recentlyViewed: {
      title: tr("Son baxılanlar", "Недавно просмотренные"),
      ctaLabel: tr("Təmizlə", "Очистить"),
    },
    recommends: { title: tr("Tövsiyələr", "Рекомендуем"), ctaLabel: SEE_MORE },
    topWeek: {
      title: tr("Həftənin ən yaxşı restoranları", "Лучшие рестораны недели"),
      subtitle: tr(
        "Hər həftə yenilənən bu siyahılarla digər qonaqlar arasında populyar olan məkanları kəşf edin.",
        "Узнайте, что популярно у других гостей, — эти списки обновляются каждую неделю.",
      ),
      tabLabels: tr(["Ən çox baxılan", "Ən çox yadda saxlanılan"], ["Самые просматриваемые", "Чаще всего сохраняют"]),
    },
    surprise: {
      title: tr(
        "Harada yemək istədiyinə qərar verə bilmirsən? Biz kömək edək.",
        "Не знаете, где поесть? Мы поможем.",
      ),
      ctaLabel: SURPRISE_ME,
    },
  },
};

// Surprise-me copy (Settings.surprise.translations), keyed by field.
const SURPRISE_TRANSLATIONS = {
  title: SURPRISE_ME,
  loadingTitle: tr("Sizin üçün ideal məkanı axtarırıq", "Ищем идеальное место для вас"),
  loadingSubtitle: tr(
    "Seçimlərinizə əsasən ən yaxşı restoranları seçirik.",
    "Подбираем лучшие рестораны с учётом ваших предпочтений.",
  ),
  emptyTitle: tr(
    "Təəssüf ki, bu ərazidə başqa nəticə tapa bilmədik",
    "К сожалению, мы не нашли других вариантов в этом районе",
  ),
  emptySubtitle: tr(
    "Daha çox nəticə görmək üçün başqa ərazidə yenidən cəhd edin və ya aşağıdakı təkliflərdən birini sınayın.",
    "Попробуйте другой район, чтобы увидеть больше вариантов, или воспользуйтесь одним из предложенных запросов ниже.",
  ),
  emptyCta: tr("Ana səhifəyə qayıt", "Вернуться на главную"),
  foundTitle: tr("Sizin üçün ideal məkanı tapdıq.", "Мы нашли для вас идеальное место."),
  againCta: tr("Yenidən təəccübləndir", "Удиви ещё раз"),
  exploreCta: tr("Bu məkana bax", "Посмотреть место"),
  preferencesNote: tr("Seçimlərinizə əsasən seçildi.", "Подобрано с учётом ваших предпочтений."),
};

// az / ru of LEGACY_PRIVACY_DATA_SECTION (catalogDefaults.js) as shipped — a
// stored translation still equal to these is replaced by the new short section.
const LEGACY_PRIVACY_DATA_SECTION_TRANSLATIONS = section(
  tr("Məlumatlarınız və hüquqlarınız", "Ваши данные и права"),
  tr(
    "İstənilən vaxt şəxsi məlumatlarınıza baxmaq, onları düzəltmək və ya silmək hüququnuz var. Məlumatlarınızın surətini Profil → Parametrlər → Məlumatlarımı yüklə bölməsindən endirə bilərsiniz.\n\nŞəxsi məlumatlarınızı üçüncü tərəflərə satmırıq. Məlumatlardan yalnız Yumio təcrübənizi yaxşılaşdırmaq üçün istifadə olunur.",
    "Вы вправе в любое время получить доступ к своим персональным данным, исправить или удалить их. Копию данных можно скачать в разделе Профиль → Настройки → Скачать мои данные.\n\nМы не продаём ваши персональные данные третьим лицам. Данные используются только для того, чтобы сделать Yumio удобнее для вас.",
  ),
);

export {
  TAXONOMY_TRANSLATIONS,
  TAXONOMY_GROUP_TRANSLATIONS,
  CITY_TRANSLATIONS,
  COUNTRY_TRANSLATIONS,
  FAQ_TRANSLATIONS,
  ONBOARDING_TRANSLATIONS,
  PAGE_TRANSLATIONS,
  LEGACY_PRIVACY_DATA_SECTION_TRANSLATIONS,
  SETTINGS_ROOT_TRANSLATIONS,
  SETTINGS_LIST_TRANSLATIONS,
  SURPRISE_TRANSLATIONS,
};
