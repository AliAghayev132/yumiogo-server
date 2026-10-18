/**
 * Azerbaijani / Russian texts of the demo data (demoData.js), so "Load mock
 * data" shows the content languages: restaurant descriptions and addresses
 * (names are proper nouns and mostly stay as they are), menu category names
 * and dish names / descriptions. SeedService turns them into each document's
 * `translations`; a text without an entry here simply stays English.
 */

const tr = (az, ru) => ({ az, ru });

// Restaurant key → az / ru fields (address = "<street>, <hood>" as stored).
const RESTAURANTS = {
  whiteCity: {
    address: tr("Xaqani Rüstəmov küç. 5, Ağ Şəhər, Xətai", "ул. Хагани Рустамова, 5, Белый город, Хатаи"),
    description: tr(
      "Ağ Şəhərin mərkəzində, şüşə dam altında zərif restoran: beynəlxalq menyu, səmimi xidmət və yeni bulvara açılan mənzərə.",
      "Изысканный зал под стеклянной крышей в самом сердце Белого города: интернациональное меню, тёплый сервис и вид на новый бульвар.",
    ),
  },
  sahil: {
    address: tr("Neftçilər pr. 34, Dənizkənarı Bulvar, Səbail", "пр. Нефтяников, 34, Приморский бульвар, Сабаил"),
    description: tr(
      "Bulvarda dənizkənarı bar və restoran: yerli yeməklər, Xəzər dəniz məhsulları və gecəyarısınadək kokteyllərlə zəngin menyu.",
      "Бар-ресторан у моря на бульваре с ярким меню из местных блюд, каспийских морепродуктов и коктейлями до поздней ночи.",
    ),
  },
  anadolu: {
    address: tr("Puşkin küç. 5, Nəsimi", "ул. Пушкина, 5, Насими"),
    description: tr(
      "Kabab, meze və təzə bişmiş pide təqdim edən əsl türk mətbəxi. Böyük porsiyalar, ailələr üçün rahat zal və tədbirlər üçün keyterinq.",
      "Настоящая турецкая кухня: кебабы, мезе и свежеиспечённое пиде. Щедрые порции, уютный зал для всей семьи и кейтеринг для мероприятий.",
    ),
  },
  caspianGrill: {
    address: tr("Neftçilər pr. 153, Port Baku", "пр. Нефтяников, 153, Порт Баку"),
    description: tr(
      "Xəzərə baxan müasir qril-haus: quru yetişdirilmiş steyklər, kömür üzərində kabablar və mövsümi məhsullar.",
      "Современный гриль-хаус с видом на Каспий: стейки сухой выдержки, кебабы на углях и сезонные продукты.",
    ),
  },
  caravan: {
    address: tr("Kiçik Qala küç. 12, İçərişəhər, Səbail", "ул. Кичик Гала, 12, Ичеришехер, Сабаил"),
    description: tr(
      "İçərişəhərdəki tağlı karvansarayda klassik Azərbaycan restoranı: şah plov, piti və həftəsonları canlı muğam.",
      "Классический азербайджанский ресторан в сводчатом караван-сарае Старого города: шах-плов, пити и живой мугам по выходным.",
    ),
  },
  firuze: {
    address: tr("Rəsul Rza küç. 14, Fəvvarələr meydanı, Nəsimi", "ул. Расула Рзы, 14, площадь Фонтанов, Насими"),
    description: tr(
      "Fəvvarələr meydanının yanında, zirzəmidə yerləşən sevimli məkan: doyumlu Azərbaycan klassikləri, təzə salatlar və ev desertləri.",
      "Любимое заведение в полуподвале у площади Фонтанов: сытная азербайджанская классика, свежие салаты и домашние десерты.",
    ),
  },
  chinaTown: {
    address: tr("Dilarə Əliyeva küç. 204, Nəsimi", "ул. Диляры Алиевой, 204, Насими"),
    description: tr(
      "Şəhərin canlı guşəsində yerləşən China Town ailələr və qruplar üçün ideal olan rahat, səmimi zal təklif edir. Menyuda klassik Çin yeməkləri müasir yanaşma ilə birləşir.",
      "China Town расположился в оживлённом уголке города: уютный гостеприимный зал идеально подходит для семей и компаний. В меню — любимая китайская классика в современном прочтении.",
    ),
  },
  mamaMeri: {
    address: tr("Heydər Əliyev pr. 45, Nərimanov", "пр. Гейдара Алиева, 45, Нариманов"),
    description: tr(
      "Xinkali, xaçapuri və həftəsonları gec saatlaradək davam edən canlı, səmimi ab-havası ilə tanınan gürcü mətbəxi.",
      "Тёплая грузинская кухня, известная хинкали, хачапури и живой радушной атмосферой, которая по выходным длится допоздна.",
    ),
  },
  nero: {
    address: tr("Şərifzadə küç. 21, Yasamal", "ул. Шарифзаде, 21, Ясамал"),
    description: tr(
      "Odun sobasında bişirilən pizza, əl ilə hazırlanan pasta və kiçik, seçilmiş şərab kartı ilə müasir italyan bistrosu.",
      "Современное итальянское бистро: пицца из дровяной печи, паста ручной работы и небольшая продуманная винная карта.",
    ),
  },
  sushiHouse: {
    address: tr("28 May küç. 3, 28 May, Nəsimi", "ул. 28 Мая, 3, 28 Мая, Насими"),
    description: tr(
      "28 May yaxınlığında neon işıqlı suşi-bar: böyük rollar, nigiri setləri və qruplar üçün paylaşım dəstləri.",
      "Суши-бар в неоновом свете у метро 28 Мая: щедрые роллы, сеты нигири и большие сеты для компаний.",
    ),
  },
  baskent: {
    address: tr("İnşaatçılar pr. 22, Yasamal", "пр. Иншаатчылар, 22, Ясамал"),
    description: tr(
      "Türk və Azərbaycan qrili, lahmacun və futbol matçından sonra gecə çayı üçün məhəllənin sevimli məkanı.",
      "Любимое место района: турецкий и азербайджанский гриль, лахмаджун и поздний чай после футбольного матча.",
    ),
  },
  burgerLab: {
    address: tr("Fətəli Xan Xoyski pr. 14, Gənclik, Nərimanov", "пр. Фатали Хана Хойского, 14, Гянджлик, Нариманов"),
    description: tr(
      "Gənclik Mall-un yemək zonasında smash burgerlər, xırtıldayan toyuq və qatı şeyklər — gecə saat birədək açıqdır.",
      "Смэш-бургеры, хрустящая курица и густые шейки на фуд-корте Ganjlik Mall — открыто до часу ночи.",
    ),
  },
  wokRoll: {
    address: tr("Nizami küç. 88, Nəsimi", "ул. Низами, 88, Насими"),
    description: tr(
      "Yerində yemək və ya özünlə götürmək üçün sürətli, təzə vok əriştəsi və ramen, çoxlu vegan seçimlə.",
      "Быстрая и свежая лапша вок и рамен — в зале или с собой, с большим выбором веганских блюд.",
    ),
  },
  seaBreeze: {
    address: tr("Nardaran şossesi 1, Nardaran, Abşeron", "Нардаранское шоссе, 1, Нардаран, Апшерон"),
    description: tr(
      "Sea Breeze-də sahildə balıq restoranı: günün Xəzər ovu, qrildə krevetlər və gün batımı mənzərəsi. Mövsümi təmir üçün bağlıdır.",
      "Рыбный ресторан на берегу в Sea Breeze: каспийский улов дня, креветки на гриле и закаты над морем. Закрыт на сезонный ремонт.",
    ),
  },
  qutabChay: {
    address: tr("Asəf Zeynallı küç. 9, İçərişəhər, Səbail", "ул. Асафа Зейналлы, 9, Ичеришехер, Сабаил"),
    description: tr(
      "İçərişəhərdə kiçik çay evi: sacdan təzə düşmüş qutab, paxlava və mürəbbə ilə bitib-tükənməyən qara çay.",
      "Крошечная чайхана в Старом городе: кутабы прямо с саджа, пахлава и бесконечные чайники чёрного чая с вареньем.",
    ),
  },
  brunchClub: {
    address: tr("Bayıl küç. 7, Bayıl, Səbail", "ул. Баилова, 7, Баилово, Сабаил"),
    description: tr(
      "Bütün gün branç təqdim edən işıqlı məkan: avokado tost, pankeyklər, seçmə qəhvə və günəşli terras.",
      "Светлое место с бранчами весь день: тост с авокадо, панкейки, спешелти-кофе и солнечная терраса.",
    ),
  },
  tandoor: {
    address: tr("Təbriz küç. 44, Nərimanov", "ул. Тебриза, 44, Нариманов"),
    description: tr(
      "Gil təndirli hind karri evi: zəngin karrilər və təzə bişmiş nan; kərə yağlı toyuğun (butter chicken) çoxlu pərəstişkarı var.",
      "Индийский ресторан с глиняным тандыром, насыщенными карри и свежим нааном; у здешнего баттер-чикен есть настоящие поклонники.",
    ),
  },
  pastaBasta: {
    address: tr("Nizami küç. 45, Səbail", "ул. Низами, 45, Сабаил"),
    description: tr(
      "Nizami küçəsində canlı trattoriya: vitrin önündə hazırlanan təzə pasta və növbəyə dəyən tiramisu.",
      "Оживлённая траттория на улице Низами: свежая паста, которую готовят прямо в витрине, и тирамису, ради которого стоит постоять в очереди.",
    ),
  },
  dolma: {
    address: tr("Böyük Qala küç. 26, İçərişəhər, Səbail", "ул. Беюк Гала, 26, Ичеришехер, Сабаил"),
    description: tr(
      "Hər yeməyin mövsümi, yerli məhsullardan hazırlandığı ənənəvi dolma evi.",
      "Традиционный дом долмы, где каждое блюдо готовят из сезонных местных продуктов.",
    ),
  },
  anadoluDoner: {
    address: tr("Səməd Vurğun küç. 41, 28 May, Nəsimi", "ул. Самеда Вургуна, 41, 28 Мая, Насими"),
    description: tr(
      "28 May metrosu yaxınlığında gecə-gündüz işləyən dönər və lahmacun piştaxtası — gec gəzintidən sonra ilk ünvan.",
      "Круглосуточная стойка с дёнером и лахмаджуном у метро 28 Мая — главное место после поздней прогулки.",
    ),
  },
  ganjaKebab: {
    name: tr("Gəncə Kabab Evi", "Гянджинский кебаб-хаус"),
    address: tr("Cavad xan küç. 18, Kəpəz", "ул. Джавад хана, 18, Кяпаз"),
    description: tr(
      "Gəncənin piyada küçəsində ailə kabab evi: birbaşa manqaldan lülə, tikə və sac.",
      "Семейный кебаб-хаус на пешеходной улице Гянджи: люля, тике и садж прямо с мангала.",
    ),
  },
  nizamiGarden: {
    address: tr("Atatürk pr. 4, Xan bağı, Kəpəz", "пр. Ататюрка, 4, Ханский сад, Кяпаз"),
    description: tr(
      "Xan bağının yanında yaşıllıq içində kafe: Gəncə paxlavası, kreplər və yaxşı qəhvə.",
      "Утопающее в зелени кафе у Ханского сада: гянджинская пахлава, блинчики и хороший кофе.",
    ),
  },
  sumqayitGrill: {
    address: tr("Sülh küç. 2, Dənizkənarı Bulvar", "ул. Сульх, 2, Приморский бульвар"),
    description: tr(
      "Sumqayıt bulvarında qrildə balıq və ət — yay axşamları ailələrin sevimli məkanı.",
      "Рыба и мясо на гриле на сумгайытском бульваре — летними вечерами здесь много семей.",
    ),
  },
  shakiCaravan: {
    name: tr("Şəki Karvansaray Restoranı", "Ресторан «Шекинский караван-сарай»"),
    address: tr("M. F. Axundzadə pr. 185, Köhnə şəhər", "пр. М. Ф. Ахундзаде, 185, Старый город"),
    description: tr(
      "Yuxarı Karvansarayın XVIII əsrə aid kərpic tağları altında: Şəki pitisi, halva və samovar çayı.",
      "Ужин под кирпичными арками Верхнего караван-сарая XVIII века: шекинский пити, халва и чай из самовара.",
    ),
  },
  qubaGarden: {
    name: tr("Quba Alma Bağı", "Губинский яблоневый сад"),
    address: tr("Qaçrəş yolu 12, Qaçrəş", "Гачрешская дорога, 12, Гачреш"),
    description: tr(
      "Quba yaxınlığında bağda restoran: qrildə qızılbalıq, alma desertləri və dağ otları. Gigiyena sertifikatı yenilənənədək fəaliyyəti dayandırılıb.",
      "Ресторан в саду под Губой: форель на гриле, яблочные десерты и горные травы. Приостановлен до продления санитарного сертификата.",
    ),
  },
  greenBowl: {
    address: tr("Nizami küç. 12, Səbail", "ул. Низами, 12, Сабаил"),
    description: tr(
      "Sifarişlə hazırlanan təzə salatlar, taxıl kasaları və soyuq sıxılmış şirələr.",
      "Свежие салаты, боулы с крупами и соки холодного отжима — готовим под заказ.",
    ),
  },
  crepeCoffee: {
    address: tr("Rəşid Behbudov küç. 8, Torqovı, Nəsimi", "ул. Рашида Бейбутова, 8, Торговая, Насими"),
    description: tr(
      "Torqovı küçəsinin tinində şirin və duzlu kreplər, seçmə qəhvə ilə.",
      "Сладкие и несладкие блинчики со спешелти-кофе на углу Торговой.",
    ),
  },
  lankaranTea: {
    name: tr("Lənkəran Çay Evi", "Ленкоранский чайный дом"),
    address: tr("Həzi Aslanov küç. 3, Şəhər mərkəzi", "ул. Ази Асланова, 3, центр города"),
    description: tr(
      "Lənkəran qara çayı, ləvəngi və bölgənin təzə sitrus meyvələri təqdim edən çay evi.",
      "Чайный дом с ленкоранским чёрным чаем, лявянги и свежими цитрусовыми из региона.",
    ),
  },
  oldBakuTavern: {
    address: tr("Mirzə Mənsur küç. 60, İçərişəhər, Səbail", "ул. Мирза Мансура, 60, Ичеришехер, Сабаил"),
    description: tr(
      "İçərişəhərdəki keçmiş meyxana. Həmişəlik bağlanıb və admin komandası tərəfindən Səbətə köçürülüb.",
      "Бывшая таверна в Старом городе. Закрыта навсегда, администраторы перенесли её в корзину.",
    ),
  },
};

// Menu texts (category names, dish names and descriptions): English → az / ru.
const MENU = {
  // ----- categories
  Starters: tr("Qəlyanaltılar", "Закуски"),
  Soups: tr("Şorbalar", "Супы"),
  Mains: tr("Əsas yeməklər", "Основные блюда"),
  Desserts: tr("Desertlər", "Десерты"),
  Drinks: tr("İçkilər", "Напитки"),
  "Tea & sweets": tr("Çay və şirniyyat", "Чай и сладости"),
  Mezes: tr("Mezelər", "Мезе"),
  "From the grill": tr("Qrildən", "С гриля"),
  Salads: tr("Salatlar", "Салаты"),
  "Dim sum": tr("Dim-sam", "Димсамы"),
  Wok: tr("Vok", "Вок"),
  "Small plates": tr("Kiçik porsiyalar", "Небольшие блюда"),
  Rolls: tr("Rollar", "Роллы"),
  "Nigiri & sets": tr("Nigiri və setlər", "Нигири и сеты"),
  Sides: tr("Qarnirlər", "Гарниры"),
  "Breads & dumplings": tr("Çörəklər və xinkali", "Выпечка и хинкали"),
  Dishes: tr("Yeməklər", "Блюда"),
  Antipasti: tr("Antipasti", "Антипасти"),
  "Pizza & pasta": tr("Pizza və pasta", "Пицца и паста"),
  Dolci: tr("Desertlər", "Десерты"),
  "Sides & salads": tr("Qarnirlər və salatlar", "Гарниры и салаты"),
  "From the sea": tr("Dəniz məhsulları", "Дары моря"),
  "Fried & crispy": tr("Qızardılmış və xırtıldayan", "Жареное и хрустящее"),
  Burgers: tr("Burgerlər", "Бургеры"),
  "Sides & shakes": tr("Qarnirlər və şeyklər", "Гарниры и шейки"),
  "All-day brunch": tr("Bütün gün branç", "Бранч весь день"),
  Sweet: tr("Şirniyyat", "Сладкое"),
  "Bowls & salads": tr("Boullar və salatlar", "Боулы и салаты"),
  "Drinks & treats": tr("İçkilər və şirniyyat", "Напитки и лакомства"),
  Curries: tr("Karrilər", "Карри"),
  "Rice & bread": tr("Düyü və çörək", "Рис и хлеб"),
  "Snacks & drinks": tr("Qəlyanaltılar və içkilər", "Закуски и напитки"),
  "Crepes & desserts": tr("Kreplər və desertlər", "Блинчики и десерты"),
  "Hot drinks": tr("İsti içkilər", "Горячие напитки"),
  Kebabs: tr("Kabablar", "Кебабы"),
  Grill: tr("Qril", "Гриль"),
  Tea: tr("Çay", "Чай"),
  Sweets: tr("Şirniyyat", "Сладости"),

  // ----- Azerbaijani
  "Qutab with greens": tr("Göyərti qutabı", "Кутабы с зеленью"),
  "Thin griddled flatbread filled with fresh herbs, served with yoghurt.": tr(
    "Təzə göyərti ilə doldurulmuş, sacda bişmiş nazik qutab, qatıqla verilir.",
    "Тонкая лепёшка с начинкой из свежей зелени, обжаренная на садже, подаётся с йогуртом.",
  ),
  "Qutab with lamb": tr("Ətli qutab", "Кутабы с бараниной"),
  "Crispy flatbread with minced lamb and sumac.": tr(
    "Quzu əti qiyməsi və sumaqla xırtıldayan qutab.",
    "Хрустящая лепёшка с бараньим фаршем и сумахом.",
  ),
  "Yarpaq dolma": tr("Yarpaq dolması", "Долма в виноградных листьях"),
  "Vine leaves stuffed with lamb, rice and herbs, with garlic yoghurt.": tr(
    "Quzu əti, düyü və göyərti ilə doldurulmuş üzüm yarpaqları, sarımsaqlı qatıqla.",
    "Виноградные листья с бараниной, рисом и зеленью, с чесночным йогуртом.",
  ),
  "Shepherd salad": tr("Çoban salatı", "Пастуший салат"),
  "Tomato, cucumber, onion and parsley with lemon and olive oil.": tr(
    "Pomidor, xiyar, soğan və cəfəri, limon və zeytun yağı ilə.",
    "Помидоры, огурцы, лук и петрушка с лимоном и оливковым маслом.",
  ),
  Dushbara: tr("Düşbərə", "Дюшбара"),
  "Tiny lamb dumplings in a clear broth with dried mint.": tr(
    "Quru nanə ilə şəffaf bulyonda xırda ətli düşbərə.",
    "Крошечные пельмени с бараниной в прозрачном бульоне с сушёной мятой.",
  ),
  Piti: tr("Piti", "Пити"),
  "Slow-cooked lamb and chickpea stew served in a clay pot.": tr(
    "Saxsı qabda verilən, zəif odda bişmiş quzu əti və noxud.",
    "Томлёная баранина с нутом, подаётся в глиняном горшочке.",
  ),
  "Shah plov": tr("Şah plov", "Шах-плов"),
  "Saffron rice with lamb, dried fruit and chestnuts baked in a lavash crust.": tr(
    "Lavaş içində bişirilmiş zəfəranlı düyü, quzu əti, quru meyvələr və şabalıd.",
    "Шафрановый рис с бараниной, сухофруктами и каштанами, запечённый в лаваше.",
  ),
  "Lamb shashlik": tr("Quzu şişliyi", "Шашлык из баранины"),
  "Charcoal-grilled lamb skewers with onion and sumac.": tr(
    "Kömür üzərində bişmiş quzu şişliyi, soğan və sumaqla.",
    "Шашлык из баранины на углях с луком и сумахом.",
  ),
  "Lula kebab": tr("Lülə kabab", "Люля-кебаб"),
  "Minced lamb kebab on the grill, with grilled tomato and lavash.": tr(
    "Qrildə quzu qiyməsindən kabab, közdə pomidor və lavaşla.",
    "Кебаб из бараньего фарша на гриле с печёным помидором и лавашом.",
  ),
  "Saj with lamb": tr("Quzu əti ilə sac", "Садж с бараниной"),
  "Lamb, potatoes and peppers sizzling on a saj pan.": tr(
    "Sac üzərində cızıldayan quzu əti, kartof və bibər.",
    "Баранина, картофель и перец, шкворчащие на садже.",
  ),
  "Tandir chicken": tr("Təndir toyuğu", "Цыплёнок из тандыра"),
  "Whole spring chicken baked in the tandir oven.": tr("Təndirdə bişmiş bütöv cücə.", "Целый цыплёнок, запечённый в тандыре."),
  Pakhlava: tr("Paxlava", "Пахлава"),
  "Layered walnut pastry with honey syrup.": tr(
    "Bal şərbəti ilə qatlı qozlu şirniyyat.",
    "Слоёная выпечка с грецкими орехами и медовым сиропом.",
  ),
  Shekerbura: tr("Şəkərbura", "Шекербура"),
  "Crescent pastry filled with almonds and cardamom.": tr(
    "Badam və hillə doldurulmuş aypara formalı şirniyyat.",
    "Выпечка в форме полумесяца с миндалём и кардамоном.",
  ),
  "Black tea with jam": tr("Mürəbbə ilə qara çay", "Чёрный чай с вареньем"),
  "A pot of Lankaran tea with homemade quince jam.": tr(
    "Bir çaynik Lənkəran çayı, ev üsulu heyva mürəbbəsi ilə.",
    "Чайник ленкоранского чая с домашним айвовым вареньем.",
  ),
  Ayran: tr("Ayran", "Айран"),
  "Chilled salted yoghurt drink.": tr("Soyuq, duzlu qatıq içkisi.", "Охлаждённый солёный кисломолочный напиток."),
  "Thyme tea": tr("Kəklikotu çayı", "Чай с чабрецом"),
  "Mountain thyme tea in a pear-shaped glass.": tr(
    "Armudu stəkanda dağ kəklikotu çayı.",
    "Чай с горным чабрецом в стакане-армуду.",
  ),
  Qoğal: tr("Qoğal", "Гогал"),
  "Flaky pastry with turmeric and fennel.": tr("Zerdəçal və razyana ilə qatlı xəmir.", "Слоёная выпечка с куркумой и фенхелем."),
  "Citrus plate": tr("Sitrus boşqabı", "Цитрусовая тарелка"),
  "Lankaran oranges and feijoa in season.": tr(
    "Mövsümündə Lənkəran portağalları və feyxoa.",
    "Ленкоранские апельсины и фейхоа в сезон.",
  ),

  // ----- Turkish
  Hummus: tr("Humus", "Хумус"),
  "Chickpea purée with tahini and olive oil.": tr(
    "Tahin və zeytun yağı ilə noxud püresi.",
    "Пюре из нута с тахини и оливковым маслом.",
  ),
  "Ezme salad": tr("Ezme salatı", "Салат эзме"),
  "Spicy tomato and pepper salad.": tr("Acılı pomidor və bibər salatı.", "Острый салат из помидоров и перца."),
  "Lentil soup": tr("Mərci şorbası", "Чечевичный суп"),
  "Red lentil soup with lemon and chilli butter.": tr(
    "Limon və acı bibərli kərə yağı ilə qırmızı mərci şorbası.",
    "Суп из красной чечевицы с лимоном и маслом с чили.",
  ),
  "Adana kebab": tr("Adana kababı", "Адана-кебаб"),
  "Hand-minced spicy lamb kebab with bulgur and grilled pepper.": tr(
    "Əllə doğranmış acılı quzu kababı, bulğur və közdə bibərlə.",
    "Острый кебаб из рубленной вручную баранины с булгуром и перцем гриль.",
  ),
  Iskender: tr("İsgəndər", "Искендер"),
  "Döner over pide with tomato sauce, butter and yoghurt.": tr(
    "Pide üzərində dönər, pomidor sousu, kərə yağı və qatıqla.",
    "Дёнер на пиде с томатным соусом, сливочным маслом и йогуртом.",
  ),
  "Mixed grill": tr("Qarışıq qril", "Ассорти на гриле"),
  "Adana, chicken shish, lamb chops and köfte for two.": tr(
    "İki nəfərlik: adana, toyuq şişi, quzu qabırğası və köftə.",
    "Адана, куриный шиш, бараньи рёбрышки и кёфте на двоих.",
  ),
  Lahmacun: tr("Lahmacun", "Лахмаджун"),
  "Thin crispy flatbread with spiced minced meat.": tr(
    "Ədviyyatlı qiymə ilə nazik, xırtıldayan çörək.",
    "Тонкая хрустящая лепёшка с пряным мясным фаршем.",
  ),
  Künefe: tr("Künəfə", "Кюнефе"),
  "Warm shredded pastry with melted cheese and pistachio.": tr(
    "Ərimiş pendir və püstə ilə isti tel kədayıf şirniyyatı.",
    "Тёплый десерт из тонкого теста с тянущимся сыром и фисташками.",
  ),
  Baklava: tr("Baklava", "Баклава"),
  "Pistachio baklava, four pieces.": tr("Püstəli baklava, dörd ədəd.", "Баклава с фисташками, четыре штуки."),

  // ----- Chinese / wok
  "Thai Shrimps Salad": tr("Tay krevet salatı", "Тайский салат с креветками"),
  "Thai shrimp salad": tr("Tay krevet salatı", "Тайский салат с креветками"),
  "Shrimp, glass noodles, lime and fresh herbs.": tr(
    "Krevet, şüşə əriştə, laym və təzə göyərti.",
    "Креветки, стеклянная лапша, лайм и свежая зелень.",
  ),
  "Shrimp, noodles, lime and herbs.": tr("Krevet, əriştə, laym və göyərti.", "Креветки, лапша, лайм и зелень."),
  "Four Seasons Vegetables Salad": tr("Dörd fəsil tərəvəz salatı", "Овощной салат «Четыре сезона»"),
  "Seasonal crunchy vegetables with sesame dressing.": tr(
    "Küncüt sousu ilə xırtıldayan mövsümi tərəvəzlər.",
    "Хрустящие сезонные овощи с кунжутной заправкой.",
  ),
  "Chinese Smashed Cucumber Salad": tr("Çin üsulu xiyar salatı", "Китайский салат из битых огурцов"),
  "Smashed cucumber with garlic, chilli oil and black vinegar.": tr(
    "Sarımsaq, acı bibər yağı və qara sirkə ilə əzilmiş xiyar.",
    "Битые огурцы с чесноком, маслом чили и чёрным уксусом.",
  ),
  "Glass Noodle Salad With Chicken": tr("Toyuqlu şüşə əriştə salatı", "Салат со стеклянной лапшой и курицей"),
  "Chilled glass noodles with shredded chicken and peanuts.": tr(
    "Doğranmış toyuq və yerfındığı ilə soyuq şüşə əriştə.",
    "Охлаждённая стеклянная лапша с курицей и арахисом.",
  ),
  "Thai Beef Salad": tr("Tay mal əti salatı", "Тайский салат с говядиной"),
  "Seared beef, mint, coriander and roasted rice.": tr(
    "Qızardılmış mal əti, nanə, kişniş və qovrulmuş düyü.",
    "Обжаренная говядина, мята, кинза и поджаренный рис.",
  ),
  "Spring Rolls": tr("Yaz rolları", "Спринг-роллы"),
  "Crispy vegetable rolls with sweet chilli sauce.": tr(
    "Şirin çili sousu ilə xırtıldayan tərəvəz rolları.",
    "Хрустящие овощные роллы со сладким соусом чили.",
  ),
  "Pancake Rolls": tr("Blinçik rolları", "Блинные роллы"),
  "Soft pancakes rolled around duck and cucumber.": tr(
    "Ördək əti və xiyar bükülmüş yumşaq blinçiklər.",
    "Мягкие блинчики с уткой и огурцом.",
  ),
  "Prawn Spring Rolls": tr("Krevetli yaz rolları", "Спринг-роллы с креветками"),
  "Golden rolls with prawns and glass noodles.": tr(
    "Krevet və şüşə əriştə ilə qızılı rollar.",
    "Золотистые роллы с креветками и стеклянной лапшой.",
  ),
  "Deep fried squid tempura": tr("Kalmar tempura", "Кальмар в темпуре"),
  "Light tempura squid with pepper salt.": tr("Bibərli duzla yüngül tempura kalmar.", "Лёгкий кальмар в темпуре с перечной солью."),
  "Deep Fried Prawn": tr("Qızardılmış krevet", "Креветки во фритюре"),
  "Butterflied prawns in a crisp batter.": tr("Xırtıldayan xəmirdə açılmış krevetlər.", "Креветки-бабочки в хрустящем кляре."),
  "Mix Plate": tr("Assorti", "Ассорти"),
  "Spring rolls, squid, prawns and seaweed for sharing.": tr(
    "Paylaşmaq üçün yaz rolları, kalmar, krevet və dəniz yosunu.",
    "Спринг-роллы, кальмар, креветки и водоросли на компанию.",
  ),
  "Prawn Crackers": tr("Krevet çipsləri", "Креветочные чипсы"),
  "Airy prawn crackers.": tr("Yüngül krevet çipsləri.", "Воздушные креветочные чипсы."),
  "One Pot Chinese Vegetables Soup": tr("Çin tərəvəz şorbası", "Китайский овощной суп"),
  "Clear broth with tofu, pak choi and mushrooms.": tr(
    "Tofu, pak-çoy və göbələklə şəffaf bulyon.",
    "Прозрачный бульон с тофу, пак-чоем и грибами.",
  ),
  "Corn Soup With Crab": tr("Krablı qarğıdalı şorbası", "Кукурузный суп с крабом"),
  "Velvety sweetcorn soup with crab meat.": tr(
    "Krab əti ilə məxməri qarğıdalı şorbası.",
    "Бархатистый суп из сладкой кукурузы с крабовым мясом.",
  ),
  "Congee Chickens": tr("Toyuqlu konci", "Конджи с курицей"),
  "Slow-cooked rice porridge with chicken and ginger.": tr(
    "Toyuq və zəncəfillə zəif odda bişmiş düyü sıyığı.",
    "Томлёная рисовая каша с курицей и имбирём.",
  ),
  "Hot and sour soup": tr("Acılı-turş şorba", "Кисло-острый суп"),
  "Spicy, tangy soup with tofu and bamboo shoots.": tr(
    "Tofu və bambuk zoğları ilə acılı-turş şorba.",
    "Острый кисловатый суп с тофу и побегами бамбука.",
  ),
  "Spicy, tangy soup with tofu.": tr("Tofu ilə acılı-turş şorba.", "Острый кисловатый суп с тофу."),
  "Seafood Dumpling": tr("Dəniz məhsullu dim-sam", "Пельмени с морепродуктами"),
  "Steamed dumplings with prawn and scallop.": tr(
    "Krevet və daraqlı ilbizlə buxarda bişmiş dim-sam.",
    "Паровые пельмени с креветкой и морским гребешком.",
  ),
  "Chicken Gyoza": tr("Toyuqlu gyoza", "Гёдза с курицей"),
  "Pan-fried chicken dumplings with dipping sauce.": tr(
    "Tavada qızardılmış toyuqlu gyoza, sousla.",
    "Обжаренные гёдза с курицей и соусом.",
  ),
  "Six pan-fried dumplings.": tr("Tavada qızardılmış altı gyoza.", "Шесть обжаренных гёдза."),
  "Chinese New Year Dumpling": tr("Çin Yeni il dim-samı", "Новогодние китайские пельмени"),
  "Colourful dumplings with chicken and vegetables.": tr(
    "Toyuq və tərəvəzlə rəngarəng dim-sam.",
    "Разноцветные пельмени с курицей и овощами.",
  ),
  "Chicken Noodles": tr("Toyuqlu əriştə", "Лапша с курицей"),
  "Wok-fried egg noodles with chicken and vegetables.": tr(
    "Vokda qızardılmış yumurtalı əriştə, toyuq və tərəvəzlə.",
    "Яичная лапша, обжаренная в воке с курицей и овощами.",
  ),
  "Filet in Black Beans Sauce": tr("Qara lobya sousunda file", "Филе в соусе из чёрных бобов"),
  "Beef tenderloin, peppers and fermented black beans.": tr(
    "Mal əti bonfilesi, bibər və fermentləşdirilmiş qara lobya.",
    "Говяжья вырезка, перец и ферментированные чёрные бобы.",
  ),
  "Broccoli In Garlic Sauce": tr("Sarımsaq sousunda brokkoli", "Брокколи в чесночном соусе"),
  "Stir-fried broccoli with garlic.": tr("Sarımsaqla vokda qızardılmış brokkoli.", "Брокколи, обжаренная с чесноком."),
  "Spinach With Peanuts": tr("Yerfındıqlı ispanaq", "Шпинат с арахисом"),
  "Blanched spinach, toasted peanuts and sesame.": tr(
    "Haşlanmış ispanaq, qovrulmuş yerfındığı və küncüt.",
    "Бланшированный шпинат, обжаренный арахис и кунжут.",
  ),
  "Blanched spinach, peanuts and sesame.": tr(
    "Haşlanmış ispanaq, yerfındığı və küncüt.",
    "Бланшированный шпинат, арахис и кунжут.",
  ),
  "Potato Sticks With Pepper": tr("Bibərli kartof çubuqları", "Картофельные палочки с перцем"),
  "Crispy potato strips with salt and pepper.": tr(
    "Duz və bibərlə xırtıldayan kartof çubuqları.",
    "Хрустящая картофельная соломка с солью и перцем.",
  ),
  "Wok noodles in a box": tr("Qutuda vok əriştəsi", "Лапша вок в коробочке"),
  "Egg noodles with teriyaki chicken and vegetables.": tr(
    "Teriyaki toyuq və tərəvəzlə yumurtalı əriştə.",
    "Яичная лапша с курицей терияки и овощами.",
  ),
  "Stir-fried noodles": tr("Vokda qızardılmış əriştə", "Жареная лапша"),
  "Classic chow mein with vegetables.": tr("Tərəvəzli klassik çau-meyn.", "Классический чоу-мейн с овощами."),
  "Ramen bowl": tr("Ramen", "Рамен"),
  "Rich broth, chashu chicken, soft egg and spring onion.": tr(
    "Qatı bulyon, çaşu toyuq, yumşaq bişmiş yumurta və yaşıl soğan.",
    "Насыщенный бульон, курица чашу, яйцо всмятку и зелёный лук.",
  ),
  "Crispy seaweed": tr("Xırtıldayan dəniz yosunu", "Хрустящие водоросли"),
  "Crispy fried greens with sugar and salt.": tr(
    "Şəkər və duzla xırtıldayan qızardılmış göyərti.",
    "Хрустящая жареная зелень с сахаром и солью.",
  ),
  "Noodle salad": tr("Əriştə salatı", "Салат с лапшой"),
  "Cold noodles with carrot, cucumber and peanut sauce.": tr(
    "Yerkökü, xiyar və yerfındığı sousu ilə soyuq əriştə.",
    "Холодная лапша с морковью, огурцом и арахисовым соусом.",
  ),

  // ----- Japanese
  "Dragon roll": tr("Dragon roll", "Ролл «Дракон»"),
  "Eel, cucumber and avocado topped with sesame.": tr(
    "Üstü küncütlü ilanbalığı, xiyar və avokado.",
    "Угорь, огурец и авокадо с кунжутом.",
  ),
  "Salmon rolls": tr("Qızılbalıq rolları", "Роллы с лососем"),
  "Salmon, cream cheese and cucumber, eight pieces.": tr(
    "Qızılbalıq, krem-pendir və xiyar, səkkiz ədəd.",
    "Лосось, сливочный сыр и огурец, восемь штук.",
  ),
  "Maki platter": tr("Maki dəsti", "Ассорти маки"),
  "Twenty-four assorted maki for sharing.": tr(
    "Paylaşmaq üçün iyirmi dörd müxtəlif maki.",
    "Двадцать четыре маки ассорти на компанию.",
  ),
  "Nigiri selection": tr("Nigiri seçimi", "Ассорти нигири"),
  "Chef's choice of eight nigiri.": tr("Aşpazın seçdiyi səkkiz nigiri.", "Восемь нигири на выбор шефа."),
  "Sushi board": tr("Suşi dəsti", "Суши-борд"),
  "Rolls, nigiri and sashimi for two.": tr("İki nəfərlik rollar, nigiri və saşimi.", "Роллы, нигири и сашими на двоих."),
  "Sushi set": tr("Suşi seti", "Суши-сет"),
  "Sixteen pieces of the house favourites.": tr(
    "Məkanın sevimlilərindən on altı ədəd.",
    "Шестнадцать кусочков любимых позиций заведения.",
  ),
  "Miso soup": tr("Miso şorbası", "Мисо-суп"),
  "Tofu, wakame and spring onion.": tr("Tofu, vakame və yaşıl soğan.", "Тофу, вакаме и зелёный лук."),
  Edamame: tr("Edamame", "Эдамаме"),
  "Steamed soy beans with sea salt.": tr("Dəniz duzu ilə buxarda bişmiş soya paxlası.", "Соевые бобы на пару с морской солью."),

  // ----- Georgian
  "Adjaruli khachapuri": tr("Acarı xaçapurisi", "Хачапури по-аджарски"),
  "Boat-shaped cheese bread with egg yolk and butter.": tr(
    "Yumurta sarısı və kərə yağı ilə qayıq formalı pendirli çörək.",
    "Лодочка с сыром, яичным желтком и сливочным маслом.",
  ),
  "Khinkali (5 pcs)": tr("Xinkali (5 əd.)", "Хинкали (5 шт.)"),
  "Juicy spiced beef dumplings — hold them by the knot.": tr(
    "Ədviyyatlı mal əti ilə şirəli xinkali — düyünündən tutun.",
    "Сочные хинкали с пряной говядиной — держите за хвостик.",
  ),
  "Pkhali trio": tr("Pxali üçlüyü", "Трио пхали"),
  "Spinach, beetroot and bean pâtés with walnuts.": tr(
    "Qozla ispanaq, çuğundur və lobya paştetləri.",
    "Паштеты из шпината, свёклы и фасоли с грецкими орехами.",
  ),
  Mtsvadi: tr("Mtsvadi", "Мцвади"),
  "Grilled lamb skewers with pomegranate.": tr("Narla qrildə quzu şişliyi.", "Шашлык из баранины на гриле с гранатом."),
  Lobio: tr("Lobio", "Лобио"),
  "Red bean stew in a clay pot with cornbread.": tr(
    "Saxsı qabda qırmızı lobya, qarğıdalı çörəyi ilə.",
    "Тушёная красная фасоль в глиняном горшочке с кукурузной лепёшкой.",
  ),
  Churchkhela: tr("Çurçxela", "Чурчхела"),
  "Walnuts dipped in grape must.": tr("Üzüm şirəsinə batırılmış qoz.", "Грецкие орехи в загущённом виноградном соке."),

  // ----- Italian
  Burrata: tr("Burrata", "Буррата"),
  "Burrata with heirloom tomatoes and basil oil.": tr(
    "Fermer pomidorları və reyhan yağı ilə burrata.",
    "Буррата с фермерскими томатами и базиликовым маслом.",
  ),
  "Garden salad": tr("Bağ salatı", "Садовый салат"),
  "Leaves, radish, cucumber and lemon dressing.": tr(
    "Yaşıl yarpaqlar, turp, xiyar və limon sousu.",
    "Листья салата, редис, огурец и лимонная заправка.",
  ),
  "Margherita pizza": tr("Marqarita pizza", "Пицца «Маргарита»"),
  "San Marzano tomato, fior di latte and basil from the wood oven.": tr(
    "Odun sobasından: San Marzano pomidoru, fior di latte və reyhan.",
    "Томаты Сан-Марцано, фиор-ди-латте и базилик из дровяной печи.",
  ),
  "Tagliatelle ragù": tr("Raqu ilə talyatelle", "Тальятелле с рагу"),
  "Fresh egg pasta with slow-cooked beef ragù.": tr(
    "Zəif odda bişmiş mal əti raqusu ilə təzə yumurtalı pasta.",
    "Свежая яичная паста с томлёным говяжьим рагу.",
  ),
  "Spaghetti carbonara": tr("Spagetti karbonara", "Спагетти карбонара"),
  "Carbonara with smoked beef, egg yolk and pecorino.": tr(
    "Hisə verilmiş mal əti, yumurta sarısı və pekorino ilə karbonara.",
    "Карбонара с копчёной говядиной, яичным желтком и пекорино.",
  ),
  "Mushroom risotto": tr("Göbələkli rizotto", "Ризотто с грибами"),
  "Carnaroli rice with porcini and parmesan.": tr(
    "Ağ göbələk və parmezanla karnaroli düyüsü.",
    "Рис карнароли с белыми грибами и пармезаном.",
  ),
  Tiramisu: tr("Tiramisu", "Тирамису"),
  "Mascarpone, espresso and cocoa.": tr("Maskarpone, espresso və kakao.", "Маскарпоне, эспрессо и какао."),
  "Panna cotta": tr("Panna kotta", "Панна-котта"),
  "Vanilla panna cotta with berry compote.": tr(
    "Giləmeyvə kompotu ilə vanilli panna kotta.",
    "Ванильная панна-котта с ягодным компотом.",
  ),

  // ----- Steak / seafood
  "Ribeye steak 300g": tr("Ribay steyk 300 q", "Стейк рибай 300 г"),
  "Dry-aged ribeye with rosemary butter.": tr(
    "Rozmarinli kərə yağı ilə quru yetişdirilmiş ribay.",
    "Рибай сухой выдержки с розмариновым маслом.",
  ),
  "Beef tenderloin": tr("Mal əti bonfilesi", "Говяжья вырезка"),
  "Grilled tenderloin with grilled tomatoes and rocket.": tr(
    "Közdə pomidor və roka ilə qrildə bonfile.",
    "Вырезка на гриле с томатами гриль и рукколой.",
  ),
  "Grill plate for two": tr("İki nəfərlik qril dəsti", "Гриль-сет на двоих"),
  "Lamb chops, chicken and beef kebabs with vegetables.": tr(
    "Quzu qabırğası, toyuq və mal əti kababları, tərəvəzlə.",
    "Бараньи рёбрышки, кебабы из курицы и говядины с овощами.",
  ),
  "Caesar salad": tr("Sezar salatı", "Салат «Цезарь»"),
  "Romaine, parmesan, croutons and chicken.": tr(
    "Romen kahısı, parmezan, kruton və toyuq.",
    "Романо, пармезан, гренки и курица.",
  ),
  "Grilled vegetables": tr("Qrildə tərəvəzlər", "Овощи гриль"),
  "Aubergine, peppers, courgette and tomato.": tr("Badımcan, bibər, balqabaq və pomidor.", "Баклажан, перец, цукини и томаты."),
  Cheesecake: tr("Çizkeyk", "Чизкейк"),
  "New York cheesecake with berry sauce.": tr(
    "Giləmeyvə sousu ilə Nyu-York çizkeyki.",
    "Чизкейк «Нью-Йорк» с ягодным соусом.",
  ),
  "Baked cheesecake with berry sauce.": tr("Giləmeyvə sousu ilə bişmiş çizkeyk.", "Запечённый чизкейк с ягодным соусом."),
  "Grilled sea bass": tr("Qrildə levrek", "Сибас на гриле"),
  "Whole Caspian sea bass with lemon and herbs.": tr(
    "Limon və göyərti ilə bütöv Xəzər levreki.",
    "Целый каспийский сибас с лимоном и травами.",
  ),
  "Garlic shrimp": tr("Sarımsaqlı krevet", "Креветки с чесноком"),
  "Tiger prawns with garlic, chilli and butter.": tr(
    "Sarımsaq, acı bibər və kərə yağı ilə pələng krevetləri.",
    "Тигровые креветки с чесноком, чили и сливочным маслом.",
  ),
  "Seafood platter": tr("Dəniz məhsulları dəsti", "Ассорти из морепродуктов"),
  "Prawns, calamari, mussels and fish for two.": tr(
    "İki nəfərlik krevet, kalmar, midiya və balıq.",
    "Креветки, кальмары, мидии и рыба на двоих.",
  ),
  "Fried calamari": tr("Qızardılmış kalmar", "Жареные кальмары"),
  "Crispy calamari rings with tartare sauce.": tr(
    "Tartar sousu ilə xırtıldayan kalmar halqaları.",
    "Хрустящие кольца кальмара с соусом тартар.",
  ),
  "Deep fried prawns": tr("Qızardılmış krevetlər", "Креветки во фритюре"),
  "Crispy prawns with sweet chilli.": tr("Şirin çili sousu ilə xırtıldayan krevetlər.", "Хрустящие креветки со сладким чили."),
  "Fish soup": tr("Balıq şorbası", "Рыбный суп"),
  "Sturgeon and vegetable soup.": tr("Nərə balığı və tərəvəz şorbası.", "Суп из осетрины с овощами."),

  // ----- Burgers
  "Classic burger": tr("Klassik burger", "Классический бургер"),
  "Beef patty, cheddar, pickles and house sauce, with fries.": tr(
    "Mal əti kotleti, çeddar, duzlu xiyar və ev sousu, kartof fri ilə.",
    "Говяжья котлета, чеддер, маринованные огурцы и фирменный соус, с картофелем фри.",
  ),
  "Double cheeseburger": tr("Dubl çizburger", "Двойной чизбургер"),
  "Two smashed patties with double cheese.": tr("İkiqat pendirlə iki smash kotlet.", "Две смэш-котлеты с двойным сыром."),
  "Crispy chicken burger": tr("Xırtıldayan toyuq burgeri", "Бургер с хрустящей курицей"),
  "Buttermilk chicken, slaw and chipotle mayo.": tr(
    "Ayranda marinadlanmış toyuq, kələm salatı və çipotle mayonezi.",
    "Курица в пахте, коул-слоу и майонез чипотле.",
  ),
  Fries: tr("Kartof fri", "Картофель фри"),
  "Skin-on fries with sea salt.": tr("Dəniz duzu ilə qabıqlı kartof fri.", "Картофель фри в кожуре с морской солью."),
  "Onion rings": tr("Soğan halqaları", "Луковые кольца"),
  "Crispy battered onion rings.": tr("Xəmirdə xırtıldayan soğan halqaları.", "Хрустящие луковые кольца в кляре."),
  Milkshake: tr("Milkşeyk", "Молочный коктейль"),
  "Vanilla, chocolate or strawberry.": tr("Vanil, şokolad və ya çiyələk.", "Ванильный, шоколадный или клубничный."),

  // ----- Brunch / healthy
  "Avocado toast": tr("Avokado tost", "Тост с авокадо"),
  "Sourdough, smashed avocado, poached egg and chilli flakes.": tr(
    "Turş xəmirli çörək, əzilmiş avokado, paşot yumurta və acı bibər lopaları.",
    "Хлеб на закваске, авокадо, яйцо пашот и хлопья чили.",
  ),
  "Buttermilk pancakes": tr("Pankeyklər", "Панкейки на пахте"),
  "Stack of pancakes with maple syrup and berries.": tr(
    "Ağcaqayın siropu və giləmeyvə ilə pankeyklər.",
    "Стопка панкейков с кленовым сиропом и ягодами.",
  ),
  "Four seasons salad": tr("Dörd fəsil salatı", "Салат «Четыре сезона»"),
  "Seasonal vegetables, seeds and tahini.": tr("Mövsümi tərəvəzlər, toxumlar və tahin.", "Сезонные овощи, семечки и тахини."),
  "Crème brûlée": tr("Krem-brüle", "Крем-брюле"),
  "Classic vanilla custard with a burnt-sugar top.": tr(
    "Karamelləşmiş şəkər qabığı ilə klassik vanilli krem.",
    "Классический ванильный крем с карамельной корочкой.",
  ),
  "Vanilla custard with burnt sugar.": tr("Karamelləşmiş şəkərlə vanilli krem.", "Ванильный крем с карамелизированным сахаром."),
  "Flat white": tr("Flet uayt", "Флэт уайт"),
  "Double ristretto with silky milk.": tr("İpək kimi südlə ikiqat ristretto.", "Двойной ристретто с шелковистым молоком."),
  "Fresh orange juice": tr("Təzə portağal şirəsi", "Свежевыжатый апельсиновый сок"),
  "Pressed to order.": tr("Sifarişlə sıxılır.", "Отжимаем при заказе."),
  "Quinoa bowl": tr("Kinoa boulu", "Боул с киноа"),
  "Quinoa, roasted vegetables, chickpeas and tahini.": tr(
    "Kinoa, sobada bişmiş tərəvəzlər, noxud və tahin.",
    "Киноа, запечённые овощи, нут и тахини.",
  ),
  "Green salad": tr("Yaşıl salat", "Зелёный салат"),
  "Spinach, avocado, cucumber and seeds.": tr("İspanaq, avokado, xiyar və toxumlar.", "Шпинат, авокадо, огурец и семечки."),
  "Cold-pressed juice": tr("Soyuq sıxılmış şirə", "Сок холодного отжима"),
  "Apple, celery, ginger and lemon.": tr("Alma, kərəviz, zəncəfil və limon.", "Яблоко, сельдерей, имбирь и лимон."),
  "Chia pudding": tr("Çia pudinqi", "Пудинг чиа"),
  "Coconut milk chia with mango.": tr("Manqo ilə kokos südündə çia.", "Чиа на кокосовом молоке с манго."),

  // ----- Indian
  "Butter chicken": tr("Kərə yağlı toyuq", "Баттер-чикен"),
  "Tandoori chicken in a creamy tomato sauce.": tr(
    "Kremli pomidor sousunda təndir toyuğu.",
    "Курица тандури в сливочно-томатном соусе.",
  ),
  "Lamb rogan josh": tr("Quzu roqan coş", "Роган джош из баранины"),
  "Kashmiri lamb curry with aromatic spices.": tr(
    "Ətirli ədviyyatlarla Kəşmir üsulu quzu karrisi.",
    "Кашмирское карри из баранины с ароматными специями.",
  ),
  "Palak paneer": tr("Palak panir", "Палак панир"),
  "Spinach and cottage cheese curry.": tr("İspanaq və ev pendiri ilə karri.", "Карри из шпината и домашнего сыра."),
  "Chicken biryani": tr("Toyuqlu biryani", "Бирьяни с курицей"),
  "Basmati rice layered with spiced chicken.": tr(
    "Ədviyyatlı toyuqla qat-qat basmati düyüsü.",
    "Рис басмати слоями с пряной курицей.",
  ),
  "Garlic naan": tr("Sarımsaqlı nan", "Чесночный наан"),
  "From the tandoor.": tr("Təndirdən.", "Из тандыра."),
  "Vegetable samosa": tr("Tərəvəzli samosa", "Овощная самоса"),
  "Two crisp pastries with spiced potato.": tr(
    "Ədviyyatlı kartofla iki xırtıldayan samosa.",
    "Два хрустящих пирожка с пряным картофелем.",
  ),
  "Mango lassi": tr("Manqo lassi", "Манго-ласси"),
  "Yoghurt and mango.": tr("Qatıq və manqo.", "Йогурт и манго."),

  // ----- Desserts / cafe
  "Nutella crepe": tr("Nutellalı krep", "Блинчик с нутеллой"),
  "Warm crepe with Nutella and banana.": tr("Nutella və banan ilə isti krep.", "Тёплый блинчик с нутеллой и бананом."),
  "Celebration plate": tr("Bayram desert dəsti", "Праздничное ассорти"),
  "Chef's dessert selection with a message of your choice.": tr(
    "İstədiyiniz yazı ilə aşpazın desert seçimi.",
    "Десертное ассорти от шефа с надписью на ваш выбор.",
  ),
  "Hot chocolate": tr("İsti şokolad", "Горячий шоколад"),
  "Thick Belgian hot chocolate.": tr("Qatı Belçika isti şokoladı.", "Густой бельгийский горячий шоколад."),
  Cappuccino: tr("Kapuçino", "Капучино"),
  "Double shot with foamed milk.": tr("Köpüklü südlə ikiqat espresso.", "Двойной эспрессо со вспененным молоком."),
};

const lookup = new Map(Object.entries(MENU).map(([en, t]) => [en.trim().toLowerCase(), t]));

/**
 * `translations` for a menu category / item from its English texts:
 * menuTranslations({ name, description }) → { az: { name, description }, ru: { … } }
 * (fields without a known text are left out).
 */
const menuTranslations = (fields) => {
  const out = { az: {}, ru: {} };
  Object.entries(fields).forEach(([field, english]) => {
    const t = typeof english === "string" ? lookup.get(english.trim().toLowerCase()) : null;
    if (!t) return;
    out.az[field] = t.az;
    out.ru[field] = t.ru;
  });
  return out;
};

/** `translations` of a demo restaurant (by its demo key). */
const restaurantTranslations = (key) => {
  const entry = RESTAURANTS[key] || {};
  const out = { az: {}, ru: {} };
  Object.entries(entry).forEach(([field, t]) => {
    out.az[field] = t.az;
    out.ru[field] = t.ru;
  });
  return out;
};

export { menuTranslations, restaurantTranslations };
