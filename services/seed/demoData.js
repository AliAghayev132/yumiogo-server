import { WEEK_DAYS } from "#constants";

/**
 * Demo content of SeedService ("Load mock data"): Baku-first restaurants with
 * menus, people, and the text pools reviews / comments / searches are built
 * from. Plain data — SeedService resolves every catalog value (cuisines,
 * features, tags, dietary, moods, dining, cities) against the admin catalog
 * and drops names the catalog does not have, so admin edits are respected.
 *
 * Images are shipped with the code (never swept or wiped):
 *  - uploads/restaurants/seed/{covers,dishes,menus,avatars}/  (Figma image fills)
 *  - uploads/catalog/defaults/{cuisines,recommends}/          (catalog defaults)
 */

const SEED_DIR = "uploads/restaurants/seed";
export const cover = (name) => `${SEED_DIR}/covers/${name}.jpg`;
export const dish = (name) => `${SEED_DIR}/dishes/${name}.jpg`;
export const menuPage = (n) => `${SEED_DIR}/menus/menu-0${n}.jpg`;
export const avatar = (name) => `${SEED_DIR}/avatars/${name}.jpg`;
const cuisineImage = (file) => `uploads/catalog/defaults/cuisines/${file}`;

// Catalog-default food photos reused as dish images.
const DEFAULT_DISH = {
  platter: cuisineImage("international.jpg"),
  shashlik: cuisineImage("turkish.png"),
  noodles: cuisineImage("chinese.png"),
  burger: cuisineImage("fast-food.png"),
  shrimp: cuisineImage("seafood.png"),
  pizza: cuisineImage("italian.png"),
  sushi: cuisineImage("japanese.jpg"),
};

// ------------------------------------------------------------------ hours

const CLOSED = { open: "", close: "", closed: true };
const week = (open, close, overrides = {}) =>
  Object.fromEntries(WEEK_DAYS.map((day) => [day, overrides[day] || { open, close, closed: false }]));
const late = (open, close) => ({ open, close, closed: false });

// Weekly opening hours (app timezone). close < open runs past midnight; equal = 24h.
export const HOURS = {
  dining: week("12:00", "23:30"),
  classic: week("11:00", "23:00"),
  bar: week("12:00", "02:00"),
  lateWeekend: week("12:00", "00:00", { fri: late("12:00", "02:00"), sat: late("12:00", "02:00") }),
  grill: week("13:00", "00:00", { mon: CLOSED }),
  cafe: week("08:00", "22:00"),
  breakfast: week("08:00", "20:00", { sun: CLOSED }),
  brunch: week("09:00", "17:00", { mon: CLOSED }),
  fastFood: week("10:00", "01:00"),
  allDay: week("00:00", "00:00"),
  oldCity: week("10:00", "22:00", { sun: CLOSED }),
  bistro: week("12:00", "23:00", { mon: CLOSED }),
  noodle: week("11:00", "23:00", { fri: late("11:00", "00:30"), sat: late("11:00", "00:30") }),
  teaHouse: week("09:00", "21:00", { mon: CLOSED, tue: CLOSED }),
};

// ------------------------------------------------------------------ menus

// Item: [name, price ₼, description, dietary[], popular?, image?]
const M = {
  azStarters: [
    ["Qutab with greens", 4, "Thin griddled flatbread filled with fresh herbs, served with yoghurt.", ["Vegetarian"], true, null],
    ["Qutab with lamb", 5, "Crispy flatbread with minced lamb and sumac.", ["Halal"], false, null],
    ["Yarpaq dolma", 9, "Vine leaves stuffed with lamb, rice and herbs, with garlic yoghurt.", ["Halal", "Gluten free"], true, null],
    ["Shepherd salad", 6, "Tomato, cucumber, onion and parsley with lemon and olive oil.", ["Vegan", "Gluten free"], false, null],
  ],
  azSoups: [
    ["Dushbara", 7, "Tiny lamb dumplings in a clear broth with dried mint.", ["Halal"], false, null],
    ["Piti", 12, "Slow-cooked lamb and chickpea stew served in a clay pot.", ["Halal", "Gluten free"], true, null],
  ],
  azMains: [
    ["Shah plov", 28, "Saffron rice with lamb, dried fruit and chestnuts baked in a lavash crust.", ["Halal"], true, cover("shah-plov")],
    ["Lamb shashlik", 16, "Charcoal-grilled lamb skewers with onion and sumac.", ["Halal", "Gluten free"], true, DEFAULT_DISH.shashlik],
    ["Lula kebab", 12, "Minced lamb kebab on the grill, with grilled tomato and lavash.", ["Halal"], false, DEFAULT_DISH.platter],
    ["Saj with lamb", 22, "Lamb, potatoes and peppers sizzling on a saj pan.", ["Halal"], false, null],
    ["Tandir chicken", 14, "Whole spring chicken baked in the tandir oven.", ["Halal", "Gluten free"], false, null],
  ],
  azDesserts: [
    ["Pakhlava", 5, "Layered walnut pastry with honey syrup.", ["Vegetarian"], false, null],
    ["Shekerbura", 4, "Crescent pastry filled with almonds and cardamom.", ["Vegetarian"], false, null],
  ],
  azDrinks: [
    ["Black tea with jam", 6, "A pot of Lankaran tea with homemade quince jam.", ["Vegan"], false, null],
    ["Ayran", 2, "Chilled salted yoghurt drink.", ["Vegetarian", "Gluten free"], false, null],
  ],
  trMeze: [
    ["Hummus", 6, "Chickpea purée with tahini and olive oil.", ["Vegan", "Gluten free"], false, null],
    ["Ezme salad", 5, "Spicy tomato and pepper salad.", ["Vegan"], false, null],
    ["Lentil soup", 5, "Red lentil soup with lemon and chilli butter.", ["Vegetarian"], true, null],
  ],
  trGrill: [
    ["Adana kebab", 14, "Hand-minced spicy lamb kebab with bulgur and grilled pepper.", ["Halal"], true, DEFAULT_DISH.shashlik],
    ["Iskender", 17, "Döner over pide with tomato sauce, butter and yoghurt.", ["Halal"], true, null],
    ["Mixed grill", 26, "Adana, chicken shish, lamb chops and köfte for two.", ["Halal"], false, DEFAULT_DISH.platter],
    ["Lahmacun", 6, "Thin crispy flatbread with spiced minced meat.", ["Halal"], false, null],
  ],
  trDesserts: [
    ["Künefe", 8, "Warm shredded pastry with melted cheese and pistachio.", ["Vegetarian"], true, null],
    ["Baklava", 6, "Pistachio baklava, four pieces.", ["Vegetarian"], false, null],
  ],
  chSalads: [
    ["Thai Shrimps Salad", 16, "Shrimp, glass noodles, lime and fresh herbs.", ["Dairy-free"], true, dish("thai-shrimp-salad")],
    ["Four Seasons Vegetables Salad", 11, "Seasonal crunchy vegetables with sesame dressing.", ["Vegan"], false, dish("four-seasons-salad")],
    ["Chinese Smashed Cucumber Salad", 8, "Smashed cucumber with garlic, chilli oil and black vinegar.", ["Vegan", "Gluten free"], false, dish("cucumber-salad")],
    ["Glass Noodle Salad With Chicken", 13, "Chilled glass noodles with shredded chicken and peanuts.", ["Dairy-free"], false, dish("glass-noodle-salad")],
    ["Thai Beef Salad", 17, "Seared beef, mint, coriander and roasted rice.", ["Dairy-free", "Gluten free"], false, dish("thai-beef-salad")],
  ],
  chStarters: [
    ["Spring Rolls", 9, "Crispy vegetable rolls with sweet chilli sauce.", ["Vegan"], true, dish("spring-rolls")],
    ["Pancake Rolls", 10, "Soft pancakes rolled around duck and cucumber.", [], false, dish("pancake-rolls")],
    ["Prawn Spring Rolls", 12, "Golden rolls with prawns and glass noodles.", ["Dairy-free"], false, dish("prawn-spring-rolls")],
    ["Deep fried squid tempura", 14, "Light tempura squid with pepper salt.", ["Dairy-free"], false, dish("squid-tempura")],
    ["Deep Fried Prawn", 15, "Butterflied prawns in a crisp batter.", ["Dairy-free"], false, dish("fried-prawn")],
    ["Mix Plate", 19, "Spring rolls, squid, prawns and seaweed for sharing.", [], false, dish("mix-plate")],
    ["Prawn Crackers", 4, "Airy prawn crackers.", ["Dairy-free"], false, dish("prawn-crackers")],
  ],
  chSoups: [
    ["One Pot Chinese Vegetables Soup", 8, "Clear broth with tofu, pak choi and mushrooms.", ["Vegan"], false, dish("vegetable-soup")],
    ["Corn Soup With Crab", 10, "Velvety sweetcorn soup with crab meat.", [], false, dish("corn-crab-soup")],
    ["Congee Chickens", 9, "Slow-cooked rice porridge with chicken and ginger.", ["Dairy-free", "Gluten free"], false, dish("chicken-congee")],
    ["Hot and sour soup", 8, "Spicy, tangy soup with tofu and bamboo shoots.", ["Dairy-free"], false, dish("hot-sour-soup")],
  ],
  chDimSum: [
    ["Seafood Dumpling", 13, "Steamed dumplings with prawn and scallop.", ["Dairy-free"], true, dish("seafood-dumplings")],
    ["Chicken Gyoza", 11, "Pan-fried chicken dumplings with dipping sauce.", ["Dairy-free"], false, dish("chicken-gyoza")],
    ["Chinese New Year Dumpling", 12, "Colourful dumplings with chicken and vegetables.", ["Dairy-free"], false, dish("new-year-dumplings")],
  ],
  chMains: [
    ["Chicken Noodles", 14, "Wok-fried egg noodles with chicken and vegetables.", ["Dairy-free"], true, dish("chicken-noodles")],
    ["Filet in Black Beans Sauce", 27, "Beef tenderloin, peppers and fermented black beans.", ["Dairy-free"], true, dish("filet-black-bean")],
    ["Broccoli In Garlic Sauce", 9, "Stir-fried broccoli with garlic.", ["Vegan", "Gluten free"], false, dish("broccoli-garlic")],
    ["Spinach With Peanuts", 8, "Blanched spinach, toasted peanuts and sesame.", ["Vegan"], false, dish("spinach-peanuts")],
    ["Potato Sticks With Pepper", 7, "Crispy potato strips with salt and pepper.", ["Vegan"], false, dish("potato-sticks")],
  ],
  wok: [
    ["Wok noodles in a box", 11, "Egg noodles with teriyaki chicken and vegetables.", ["Dairy-free"], true, dish("noodle-box")],
    ["Stir-fried noodles", 10, "Classic chow mein with vegetables.", ["Vegan"], false, DEFAULT_DISH.noodles],
    ["Ramen bowl", 14, "Rich broth, chashu chicken, soft egg and spring onion.", ["Dairy-free"], true, cover("ramen-bowl")],
    ["Hot and sour soup", 7, "Spicy, tangy soup with tofu.", ["Vegan"], false, dish("hot-sour-soup")],
    ["Chicken Gyoza", 9, "Six pan-fried dumplings.", ["Dairy-free"], false, dish("chicken-gyoza")],
    ["Crispy seaweed", 5, "Crispy fried greens with sugar and salt.", ["Vegan"], false, dish("crispy-seaweed")],
    ["Noodle salad", 9, "Cold noodles with carrot, cucumber and peanut sauce.", ["Vegan"], false, dish("noodle-salad")],
  ],
  sushi: [
    ["Dragon roll", 18, "Eel, cucumber and avocado topped with sesame.", ["Dairy-free"], true, dish("dragon-roll")],
    ["Salmon rolls", 15, "Salmon, cream cheese and cucumber, eight pieces.", [], true, dish("salmon-rolls")],
    ["Maki platter", 32, "Twenty-four assorted maki for sharing.", ["Dairy-free"], false, dish("maki-platter")],
    ["Nigiri selection", 24, "Chef's choice of eight nigiri.", ["Dairy-free", "Gluten free"], false, dish("nigiri-selection")],
    ["Sushi board", 45, "Rolls, nigiri and sashimi for two.", ["Dairy-free"], false, dish("sushi-board")],
    ["Sushi set", 29, "Sixteen pieces of the house favourites.", ["Dairy-free"], false, DEFAULT_DISH.sushi],
    ["Miso soup", 5, "Tofu, wakame and spring onion.", ["Vegan"], false, null],
    ["Edamame", 5, "Steamed soy beans with sea salt.", ["Vegan", "Gluten free"], false, null],
  ],
  georgian: [
    ["Adjaruli khachapuri", 11, "Boat-shaped cheese bread with egg yolk and butter.", ["Vegetarian"], true, null],
    ["Khinkali (5 pcs)", 9, "Juicy spiced beef dumplings — hold them by the knot.", ["Halal"], true, null],
    ["Pkhali trio", 8, "Spinach, beetroot and bean pâtés with walnuts.", ["Vegan", "Gluten free"], false, null],
    ["Mtsvadi", 16, "Grilled lamb skewers with pomegranate.", ["Halal", "Gluten free"], false, DEFAULT_DISH.shashlik],
    ["Lobio", 7, "Red bean stew in a clay pot with cornbread.", ["Vegan"], false, null],
    ["Churchkhela", 4, "Walnuts dipped in grape must.", ["Vegan"], false, null],
  ],
  italianStarters: [
    ["Burrata", 14, "Burrata with heirloom tomatoes and basil oil.", ["Vegetarian", "Gluten free"], false, null],
    ["Garden salad", 9, "Leaves, radish, cucumber and lemon dressing.", ["Vegan", "Gluten free"], false, dish("garden-salad")],
  ],
  italianMains: [
    ["Margherita pizza", 13, "San Marzano tomato, fior di latte and basil from the wood oven.", ["Vegetarian"], true, DEFAULT_DISH.pizza],
    ["Tagliatelle ragù", 17, "Fresh egg pasta with slow-cooked beef ragù.", [], true, null],
    ["Spaghetti carbonara", 16, "Carbonara with smoked beef, egg yolk and pecorino.", [], false, null],
    ["Mushroom risotto", 18, "Carnaroli rice with porcini and parmesan.", ["Vegetarian", "Gluten free"], false, null],
  ],
  italianDesserts: [
    ["Tiramisu", 8, "Mascarpone, espresso and cocoa.", ["Vegetarian"], true, null],
    ["Panna cotta", 7, "Vanilla panna cotta with berry compote.", ["Vegetarian", "Gluten free"], false, null],
  ],
  steak: [
    ["Ribeye steak 300g", 58, "Dry-aged ribeye with rosemary butter.", ["Gluten free"], true, cover("steak-board")],
    ["Beef tenderloin", 64, "Grilled tenderloin with grilled tomatoes and rocket.", ["Gluten free"], true, cover("steak-tomatoes")],
    ["Grill plate for two", 72, "Lamb chops, chicken and beef kebabs with vegetables.", ["Halal", "Gluten free"], false, cover("grill-plate")],
    ["Caesar salad", 14, "Romaine, parmesan, croutons and chicken.", [], false, null],
    ["Grilled vegetables", 11, "Aubergine, peppers, courgette and tomato.", ["Vegan", "Gluten free"], false, null],
    ["Cheesecake", 9, "New York cheesecake with berry sauce.", ["Vegetarian"], false, dish("cheesecake")],
  ],
  seafood: [
    ["Grilled sea bass", 32, "Whole Caspian sea bass with lemon and herbs.", ["Gluten free", "Dairy-free"], true, null],
    ["Garlic shrimp", 24, "Tiger prawns with garlic, chilli and butter.", ["Gluten free"], true, DEFAULT_DISH.shrimp],
    ["Seafood platter", 68, "Prawns, calamari, mussels and fish for two.", [], false, DEFAULT_DISH.shrimp],
    ["Fried calamari", 16, "Crispy calamari rings with tartare sauce.", [], false, dish("mix-plate")],
    ["Deep fried prawns", 18, "Crispy prawns with sweet chilli.", ["Dairy-free"], false, dish("fried-prawn")],
    ["Fish soup", 11, "Sturgeon and vegetable soup.", ["Gluten free", "Dairy-free"], false, null],
  ],
  burgers: [
    ["Classic burger", 12, "Beef patty, cheddar, pickles and house sauce, with fries.", ["Halal"], true, DEFAULT_DISH.burger],
    ["Double cheeseburger", 15, "Two smashed patties with double cheese.", ["Halal"], true, null],
    ["Crispy chicken burger", 11, "Buttermilk chicken, slaw and chipotle mayo.", ["Halal"], false, null],
    ["Fries", 4, "Skin-on fries with sea salt.", ["Vegan"], false, cover("plated-fries")],
    ["Onion rings", 5, "Crispy battered onion rings.", ["Vegetarian"], false, null],
    ["Milkshake", 6, "Vanilla, chocolate or strawberry.", ["Vegetarian", "Gluten free"], false, null],
  ],
  brunch: [
    ["Avocado toast", 12, "Sourdough, smashed avocado, poached egg and chilli flakes.", ["Vegetarian"], true, null],
    ["Buttermilk pancakes", 10, "Stack of pancakes with maple syrup and berries.", ["Vegetarian"], true, null],
    ["Garden salad", 9, "Leaves, radish, cucumber and lemon dressing.", ["Vegan", "Gluten free"], false, dish("garden-salad")],
    ["Four seasons salad", 11, "Seasonal vegetables, seeds and tahini.", ["Vegan"], false, dish("four-seasons-salad")],
    ["Crème brûlée", 7, "Classic vanilla custard with a burnt-sugar top.", ["Vegetarian", "Gluten free"], false, dish("creme-brulee")],
    ["Flat white", 5, "Double ristretto with silky milk.", ["Vegetarian"], false, null],
    ["Fresh orange juice", 6, "Pressed to order.", ["Vegan", "Gluten free"], false, null],
  ],
  healthy: [
    ["Quinoa bowl", 12, "Quinoa, roasted vegetables, chickpeas and tahini.", ["Vegan", "Gluten free"], true, dish("four-seasons-salad")],
    ["Green salad", 10, "Spinach, avocado, cucumber and seeds.", ["Vegan", "Gluten free"], true, cover("green-salad")],
    ["Thai shrimp salad", 14, "Shrimp, noodles, lime and herbs.", ["Dairy-free"], false, dish("thai-shrimp-salad")],
    ["Spinach with peanuts", 8, "Blanched spinach, peanuts and sesame.", ["Vegan"], false, dish("spinach-peanuts")],
    ["Cold-pressed juice", 7, "Apple, celery, ginger and lemon.", ["Vegan", "Gluten free", "Organic"], false, null],
    ["Chia pudding", 6, "Coconut milk chia with mango.", ["Vegan", "Gluten free"], false, null],
  ],
  indian: [
    ["Butter chicken", 17, "Tandoori chicken in a creamy tomato sauce.", ["Halal", "Gluten free"], true, null],
    ["Lamb rogan josh", 19, "Kashmiri lamb curry with aromatic spices.", ["Halal", "Gluten free"], true, null],
    ["Palak paneer", 13, "Spinach and cottage cheese curry.", ["Vegetarian", "Gluten free"], false, null],
    ["Chicken biryani", 16, "Basmati rice layered with spiced chicken.", ["Halal"], false, null],
    ["Garlic naan", 3, "From the tandoor.", ["Vegetarian"], false, null],
    ["Vegetable samosa", 5, "Two crisp pastries with spiced potato.", ["Vegan"], false, null],
    ["Mango lassi", 5, "Yoghurt and mango.", ["Vegetarian", "Gluten free"], false, null],
  ],
  desserts: [
    ["Nutella crepe", 7, "Warm crepe with Nutella and banana.", ["Vegetarian"], true, null],
    ["Crème brûlée", 7, "Vanilla custard with burnt sugar.", ["Vegetarian", "Gluten free"], true, dish("creme-brulee")],
    ["Cheesecake", 8, "Baked cheesecake with berry sauce.", ["Vegetarian"], false, dish("cheesecake")],
    ["Celebration plate", 15, "Chef's dessert selection with a message of your choice.", ["Vegetarian"], false, dish("celebration-dessert")],
    ["Hot chocolate", 5, "Thick Belgian hot chocolate.", ["Vegetarian", "Gluten free"], false, null],
    ["Cappuccino", 4, "Double shot with foamed milk.", ["Vegetarian"], false, null],
  ],
};

// Menu section templates: [category name, items].
const MENUS = {
  azerbaijani: [["Starters", M.azStarters], ["Soups", M.azSoups], ["Mains", M.azMains], ["Desserts", M.azDesserts], ["Drinks", M.azDrinks]],
  azerbaijaniSmall: [["Starters", M.azStarters.slice(0, 3)], ["Mains", M.azMains.slice(1, 4)], ["Tea & sweets", [...M.azDesserts, M.azDrinks[0]]]],
  turkish: [["Mezes", M.trMeze], ["From the grill", M.trGrill], ["Desserts", M.trDesserts]],
  chinaTown: [["Salads", M.chSalads.slice(0, 3)], ["Starters", M.chStarters.slice(0, 4)], ["Soups", M.chSoups.slice(0, 2)], ["Dim sum", M.chDimSum.slice(0, 2)], ["Mains", M.chMains.slice(0, 4)]],
  wok: [["Wok", M.wok.slice(0, 3)], ["Small plates", M.wok.slice(3)]],
  sushi: [["Rolls", M.sushi.slice(0, 3)], ["Nigiri & sets", M.sushi.slice(3, 6)], ["Sides", M.sushi.slice(6)]],
  georgian: [["Breads & dumplings", M.georgian.slice(0, 2)], ["Dishes", M.georgian.slice(2)]],
  italian: [["Antipasti", M.italianStarters], ["Pizza & pasta", M.italianMains], ["Dolci", M.italianDesserts]],
  steak: [["From the grill", M.steak.slice(0, 3)], ["Sides & salads", M.steak.slice(3, 5)], ["Desserts", M.steak.slice(5)]],
  seafood: [["From the sea", M.seafood.slice(0, 3)], ["Fried & crispy", M.seafood.slice(3, 5)], ["Soups", M.seafood.slice(5)]],
  burgers: [["Burgers", M.burgers.slice(0, 3)], ["Sides & shakes", M.burgers.slice(3)]],
  brunch: [["All-day brunch", M.brunch.slice(0, 4)], ["Sweet", M.brunch.slice(4, 5)], ["Drinks", M.brunch.slice(5)]],
  healthy: [["Bowls & salads", M.healthy.slice(0, 4)], ["Drinks & treats", M.healthy.slice(4)]],
  indian: [["Curries", M.indian.slice(0, 3)], ["Rice & bread", M.indian.slice(3, 5)], ["Snacks & drinks", M.indian.slice(5)]],
  desserts: [["Crepes & desserts", M.desserts.slice(0, 4)], ["Hot drinks", M.desserts.slice(4)]],
  international: [["Starters", [M.italianStarters[1], M.azStarters[2], M.trMeze[0]]], ["Mains", [M.steak[1], M.seafood[0], M.italianMains[1], M.azMains[0]]], ["Desserts", [M.italianDesserts[0], M.desserts[1]]]],
  mediterranean: [["Mezes", M.trMeze], ["Mains", [M.seafood[0], M.seafood[1], M.steak[4]]], ["Desserts", [M.italianDesserts[1], M.trDesserts[1]]]],
  grillHouse: [["Kebabs", M.azMains.slice(1, 3)], ["Grill", [M.steak[2], M.trGrill[2]]], ["Sides", [M.azStarters[3], M.azStarters[0]]], ["Drinks", M.azDrinks]],
  teaHouse: [
    ["Tea", [M.azDrinks[0], ["Thyme tea", 5, "Mountain thyme tea in a pear-shaped glass.", ["Vegan"], true, null]]],
    ["Sweets", [...M.azDesserts, ["Qoğal", 3, "Flaky pastry with turmeric and fennel.", ["Vegetarian"], false, null], ["Citrus plate", 4, "Lankaran oranges and feijoa in season.", ["Vegan", "Gluten free"], false, null]]],
  ],
};

// ------------------------------------------------------------ restaurants

/**
 * city = City.name; address = street, hood = neighbourhood (stored as
 * "<street>, <hood>"). coords = [lng, lat].
 * price: [avgPrice, priceMin, priceMax] in ₼. age = days since the listing
 * was added. hot = relative popularity (views / saves / reviews), rising =
 * activity picked up this week, quality = share of happy reviews.
 */
export const RESTAURANTS = [
  {
    key: "whiteCity", name: "White City Restaurant & Bar", city: "Baku", hood: "White City, Khatai",
    address: "Khagani Rustamov str. 5", coords: [49.8818, 40.3786], phone: "+994124041010",
    description: "A refined dining room under a glass roof in the heart of White City, with an international menu, warm service and views over the new boulevard.",
    cuisines: ["International", "Mediterranean"], tags: ["Trendy", "Local dishes"], features: ["Accepts Credit Cards", "Seating", "Reservations", "Parking", "Wifi"],
    dietary: ["Vegetarian", "Gluten free"], moods: ["Romantic", "Family"], dining: ["Lunch", "Dinner"],
    price: [55, 25, 90], hours: "dining", menu: "international", discount: 0, age: 170, hot: 9, rising: 1.2, quality: 0.85,
    covers: ["glass-roof", "panorama-hall", "steak-tomatoes", "wine-table"],
  },
  {
    key: "sahil", name: "SAHiL Bar & Restaurant", city: "Baku", hood: "Seaside Boulevard, Sabail",
    address: "Neftchilar Ave. 34", coords: [49.8448, 40.3651], phone: "+994124040303",
    description: "Seaside bar and restaurant on the boulevard with a vibrant menu of local dishes, Caspian seafood and cocktails until late.",
    cuisines: ["Azerbaijani", "Seafood", "International"], tags: ["Local dishes", "Trendy", "Halal", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Outdoor Seating", "Reservations", "Wifi"],
    dietary: ["Halal", "Vegetarian", "Vegan"], moods: ["With friends", "Trendy", "Romantic"], dining: ["Lunch", "Dinner"],
    price: [60, 20, 120], hours: "bar", menu: "seafood", discount: 15, age: 160, hot: 10, rising: 1.5, quality: 0.8,
    covers: ["sahil-front", "sea-terrace", "grill-plate", "bar-counter"],
  },
  {
    key: "anadolu", name: "Anadolu Restaurant & Catering", city: "Baku", hood: "Nasimi",
    address: "Pushkin str. 5", coords: [49.8408, 40.3712], phone: "+994124982211",
    description: "Authentic Turkish kitchen serving kebabs, mezes and fresh-baked pide. Generous portions, a family-friendly room and catering for events.",
    cuisines: ["Turkish"], tags: ["Local dishes", "Halal"], features: ["Accepts Credit Cards", "Seating", "Takeout", "Delivery"],
    dietary: ["Halal"], moods: ["Family", "With friends"], dining: ["Lunch", "Dinner", "Catering"],
    price: [28, 10, 60], hours: "classic", menu: "turkish", discount: 50, age: 150, hot: 8, rising: 1, quality: 0.8,
    covers: ["anadolu-front", "art-room", "street-food-spread"],
  },
  {
    key: "caspianGrill", name: "Caspian Grill", city: "Baku", hood: "Port Baku",
    address: "Neftchilar Ave. 153", coords: [49.8603, 40.3756], phone: "+994125055505",
    description: "Modern grill house overlooking the Caspian, focused on dry-aged steaks, charcoal kebabs and seasonal produce.",
    cuisines: ["Steakhouse", "Barbecue"], tags: ["Trendy"], features: ["Accepts Credit Cards", "Seating", "Reservations", "Parking"],
    dietary: ["Gluten free", "Halal"], moods: ["Romantic", "Quiet"], dining: ["Dinner"],
    price: [85, 40, 150], hours: "grill", menu: "steak", discount: 30, age: 140, hot: 6, rising: 0.8, quality: 0.75,
    covers: ["caspian-front", "steak-board", "steak-tomatoes"],
  },
  {
    key: "caravan", name: "Caravan Baku", city: "Baku", hood: "Icherisheher, Sabail",
    address: "Kichik Gala str. 12", coords: [49.8356, 40.3662], phone: "+994124922727",
    description: "A classic Azerbaijani restaurant in a vaulted caravanserai of the Old City, celebrating shah plov, piti and live mugham on weekends.",
    cuisines: ["Azerbaijani"], tags: ["Local dishes", "Halal"], features: ["Accepts Credit Cards", "Seating", "Reservations"],
    dietary: ["Halal", "Vegetarian"], moods: ["Family", "Romantic"], dining: ["Lunch", "Dinner", "Catering"],
    price: [45, 15, 80], hours: "oldCity", menu: "azerbaijani", discount: 0, age: 175, hot: 9, rising: 1.1, quality: 0.9,
    covers: ["stone-vault", "shah-plov", "azerbaijani-spread"],
  },
  {
    key: "firuze", name: "Firuze Restaurant", city: "Baku", hood: "Fountain Square, Nasimi",
    address: "Rasul Rza str. 14", coords: [49.8381, 40.3702], phone: "+994124931355",
    description: "Beloved basement spot next to Fountain Square for hearty Azerbaijani classics, fresh salads and homemade desserts.",
    cuisines: ["Azerbaijani"], tags: ["Local dishes", "Halal"], features: ["Accepts Credit Cards", "Seating", "Takeout"],
    dietary: ["Halal", "Vegetarian"], moods: ["Family", "Quiet"], dining: ["Lunch", "Dinner"],
    price: [30, 8, 55], hours: "classic", menu: "azerbaijani", discount: 0, age: 130, hot: 7, rising: 0.9, quality: 0.85,
    covers: ["cozy-room", "feast-table", "azerbaijani-spread"],
  },
  {
    key: "chinaTown", name: "China Town Restaurant", city: "Baku", hood: "Nasimi",
    address: "204 Dilara Aliyeva str.", coords: [49.8501, 40.3808], phone: "+994124409988",
    description: "Nestled in a vibrant corner of the city, China Town offers a cozy, inviting room that is ideal for families and groups. The menu blends classic Chinese favourites with modern twists.",
    cuisines: ["Chinese", "Asian"], tags: ["Trendy", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Reservations", "Takeout", "Delivery"],
    dietary: ["Vegetarian", "Vegan", "Dairy-free"], moods: ["With friends", "Family"], dining: ["Lunch", "Dinner"],
    price: [32, 7, 70], hours: "noodle", menu: "chinaTown", discount: 20, age: 120, hot: 10, rising: 1.8, quality: 0.85,
    covers: ["chinatown-hall", "chinatown-spread", "dumplings-red", "chinatown-orange-room", "chinatown-guests", "wok-flame"],
    menuPhotos: [1, 2, 3, 4, 5, 6, 7, 8].map(menuPage),
  },
  {
    key: "mamaMeri", name: "Mama Meri", city: "Baku", hood: "Narimanov",
    address: "Heydar Aliyev Ave. 45", coords: [49.8689, 40.4012], phone: "+994125141414",
    description: "Warm Georgian kitchen famous for khinkali, khachapuri and a lively, welcoming vibe that runs late at weekends.",
    cuisines: ["Georgian"], tags: ["Local dishes", "Trendy"], features: ["Accepts Credit Cards", "Seating", "Outdoor Seating"],
    dietary: ["Vegetarian"], moods: ["With friends", "Trendy"], dining: ["Lunch", "Dinner"],
    price: [25, 4, 45], hours: "lateWeekend", menu: "georgian", discount: 40, age: 110, hot: 7, rising: 1.3, quality: 0.8,
    covers: ["brick-room", "shared-plates", "feast-table"],
  },
  {
    key: "nero", name: "Nero Bistro", city: "Baku", hood: "Yasamal",
    address: "Sharifzade str. 21", coords: [49.8130, 40.3890], phone: "+994125376060",
    description: "Contemporary Italian bistro with wood-fired pizza, handmade pasta and a small curated wine list.",
    cuisines: ["Italian", "Pizza"], tags: ["Trendy", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Reservations", "Wifi"],
    dietary: ["Vegetarian", "Vegan", "Organic"], moods: ["Romantic", "Trendy"], dining: ["Lunch", "Dinner"],
    price: [38, 7, 70], hours: "bistro", menu: "italian", discount: 25, age: 95, hot: 6, rising: 1, quality: 0.75,
    covers: ["library-room", "lounge-bar", "chef-plating"],
  },
  {
    key: "sushiHouse", name: "Sushi House by Farah", city: "Baku", hood: "28 May, Nasimi",
    address: "28 May str. 3", coords: [49.8485, 40.3794], phone: "+994125960101",
    description: "Neon-lit sushi bar near 28 May with generous rolls, nigiri sets and sharing boards for groups.",
    cuisines: ["Japanese", "Sushi", "Asian"], tags: ["Trendy"], features: ["Accepts Credit Cards", "Seating", "Takeout", "Delivery", "Wifi"],
    dietary: ["Dairy-free", "Gluten free"], moods: ["With friends", "Trendy"], dining: ["Lunch", "Dinner"],
    price: [42, 5, 90], hours: "lateWeekend", menu: "sushi", discount: 10, age: 80, hot: 8, rising: 1.6, quality: 0.8,
    covers: ["sushi-house-front", "sushi-platter", "busy-hall"],
  },
  {
    key: "baskent", name: "Başkənd Restaurant", city: "Baku", hood: "Yasamal",
    address: "Inshaatchilar Ave. 22", coords: [49.8065, 40.3935], phone: "+994125105050",
    description: "Neighbourhood favourite for Turkish and Azerbaijani grills, lahmacun and late-night tea after a football match.",
    cuisines: ["Turkish", "Azerbaijani"], tags: ["Local dishes", "Halal"], features: ["Accepts Credit Cards", "Seating", "Takeout", "Parking"],
    dietary: ["Halal"], moods: ["Family", "With friends"], dining: ["Lunch", "Dinner"],
    price: [24, 6, 40], hours: "bar", menu: "turkish", discount: 0, age: 70, hot: 5, rising: 0.9, quality: 0.7,
    covers: ["baskent-front", "grill-plate", "feast-table"],
  },
  {
    key: "burgerLab", name: "Burger Lab", city: "Baku", hood: "Ganjlik, Narimanov",
    address: "Fatali Khan Khoyski Ave. 14", coords: [49.8508, 40.4003], phone: "+994125658080",
    description: "Smash burgers, crispy chicken and thick shakes in the Ganjlik Mall food court — open until one in the morning.",
    cuisines: ["Burger", "Fast Food", "Cheeseburger"], tags: ["Trendy", "Halal"], features: ["Accepts Credit Cards", "Seating", "Takeout", "Delivery"],
    dietary: ["Halal"], moods: ["With friends"], dining: ["Lunch", "Dinner"],
    price: [14, 4, 20], hours: "fastFood", menu: "burgers", discount: 15, age: 60, hot: 8, rising: 1.4, quality: 0.7,
    covers: ["street-food-spread", "plated-fries", "busy-hall"],
  },
  {
    key: "wokRoll", name: "Wok & Roll", city: "Baku", hood: "Nasimi",
    address: "Nizami str. 88", coords: [49.8451, 40.3745], phone: "+994125117070",
    description: "Fast, fresh wok noodles and ramen bowls to eat in or take away, with plenty of vegan options.",
    cuisines: ["Asian", "Chinese"], tags: ["Vegan options"], features: ["Accepts Credit Cards", "Seating", "Takeout", "Delivery"],
    dietary: ["Vegan", "Dairy-free"], moods: ["With friends", "Quiet"], dining: ["Lunch", "Dinner"],
    price: [18, 5, 30], hours: "noodle", menu: "wok", discount: 0, age: 45, hot: 5, rising: 1.2, quality: 0.75,
    covers: ["ramen-bowl", "wok-flame", "window-room"],
  },
  {
    key: "seaBreeze", name: "Sea Breeze Fish House", city: "Baku", hood: "Nardaran, Absheron",
    address: "Nardaran highway 1", coords: [50.0100, 40.5570], phone: "+994125550909",
    description: "Beachfront fish house at Sea Breeze with Caspian catch of the day, grilled prawns and sunset views. Closed for seasonal renovation.",
    cuisines: ["Seafood", "Mediterranean"], tags: ["Trendy"], features: ["Accepts Credit Cards", "Seating", "Outdoor Seating", "Reservations", "Parking"],
    dietary: ["Gluten free", "Dairy-free"], moods: ["Romantic", "Quiet"], dining: ["Lunch", "Dinner"],
    price: [70, 11, 140], hours: "dining", menu: "seafood", discount: 0, age: 150, hot: 3, rising: 0.4, quality: 0.8,
    covers: ["sea-terrace", "window-room", "salad-lunch"], temporarilyClosed: true,
  },
  {
    key: "qutabChay", name: "Qutab & Chay Evi", city: "Baku", hood: "Icherisheher, Sabail",
    address: "Asaf Zeynalli str. 9", coords: [49.8331, 40.3671], phone: "+994124920404",
    description: "Tiny Old City tea house serving qutab straight off the griddle, pakhlava and endless pots of black tea with jam.",
    cuisines: ["Azerbaijani", "Cafe"], tags: ["Local dishes", "Halal", "Vegan options"], features: ["Seating", "Takeout"],
    dietary: ["Halal", "Vegetarian", "Vegan"], moods: ["Quiet", "Family"], dining: ["Breakfast", "Lunch", "Dessert"],
    price: [12, 2, 22], hours: "breakfast", menu: "azerbaijaniSmall", discount: 0, age: 35, hot: 6, rising: 1.7, quality: 0.9,
    covers: ["bright-room", "azerbaijani-spread", "feast-table"],
  },
  {
    key: "brunchClub", name: "Brunch Club Baku", city: "Baku", hood: "Bayil, Sabail",
    address: "Bayil str. 7", coords: [49.8330, 40.3450], phone: "+994125304040",
    description: "Bright all-day brunch spot with avocado toast, pancakes, specialty coffee and a sunny terrace.",
    cuisines: ["Cafe", "Healthy", "Crepes"], tags: ["Trendy", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Outdoor Seating", "Wifi"],
    dietary: ["Vegetarian", "Vegan", "Gluten free", "Organic"], moods: ["With friends", "Quiet"], dining: ["Breakfast", "Brunch", "Lunch"],
    price: [26, 5, 40], hours: "brunch", menu: "brunch", discount: 0, age: 28, hot: 7, rising: 2, quality: 0.85,
    covers: ["salad-lunch", "friends-photo", "food-photo"],
  },
  {
    key: "tandoor", name: "Tandoor Nights", city: "Baku", hood: "Narimanov",
    address: "Tabriz str. 44", coords: [49.8702, 40.4023], phone: "+994125672020",
    description: "Indian curry house with a clay tandoor, rich curries and freshly baked naan; the butter chicken has a cult following.",
    cuisines: ["Indian"], tags: ["Halal", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Takeout", "Delivery"],
    dietary: ["Halal", "Vegetarian", "Vegan", "Gluten free"], moods: ["With friends", "Family"], dining: ["Lunch", "Dinner"],
    price: [29, 3, 45], hours: "lateWeekend", menu: "indian", discount: 20, age: 55, hot: 5, rising: 1.1, quality: 0.8,
    covers: ["busy-hall", "wine-table", "shared-plates"],
  },
  {
    key: "pastaBasta", name: "Pasta & Basta", city: "Baku", hood: "Sabail",
    address: "Nizami str. 45", coords: [49.8467, 40.3747], phone: "+994124986060",
    description: "Buzzing trattoria on Nizami Street with fresh pasta made in the window and tiramisu worth the queue.",
    cuisines: ["Italian"], tags: ["Trendy"], features: ["Accepts Credit Cards", "Seating", "Reservations"],
    dietary: ["Vegetarian"], moods: ["Romantic", "With friends"], dining: ["Lunch", "Dinner"],
    price: [30, 7, 50], hours: "classic", menu: "italian", discount: 0, age: 20, hot: 6, rising: 2.2, quality: 0.8,
    covers: ["lounge-bar", "chef-plating", "cozy-room"],
  },
  {
    key: "dolma", name: "Dolma Restaurant", city: "Baku", hood: "Icherisheher, Sabail",
    address: "Boyuk Gala str. 26", coords: [49.8361, 40.3668], phone: "+994124926161",
    description: "Traditional dolma house where every dish is prepared with seasonal, locally-sourced ingredients.",
    cuisines: ["Azerbaijani"], tags: ["Local dishes", "Halal", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Delivery"],
    dietary: ["Halal", "Vegetarian", "Vegan"], moods: ["Family", "Quiet"], dining: ["Lunch", "Dinner"],
    price: [27, 4, 45], hours: "oldCity", menu: "azerbaijani", discount: 20, age: 100, hot: 5, rising: 0.8, quality: 0.85,
    covers: ["azerbaijani-spread", "stone-vault", "art-room"],
  },
  {
    key: "anadoluDoner", name: "Anadolu Döner 24", city: "Baku", hood: "28 May, Nasimi",
    address: "Samad Vurgun str. 41", coords: [49.8497, 40.3780], phone: "+994125242424",
    description: "Round-the-clock döner and lahmacun counter near 28 May metro — the go-to after a late night out.",
    cuisines: ["Turkish", "Fast Food"], tags: ["Halal"], features: ["Seating", "Takeout", "Delivery"],
    dietary: ["Halal"], moods: ["With friends"], dining: ["Lunch", "Dinner"],
    price: [9, 3, 15], hours: "allDay", menu: "turkish", discount: 0, age: 12, hot: 4, rising: 2.5, quality: 0.65,
    covers: ["grill-plate", "street-food-spread"],
  },
  {
    key: "ganjaKebab", name: "Ganja Kebab House", city: "Ganja", hood: "Kapaz",
    address: "Javad Khan str. 18", coords: [46.3580, 40.6812], phone: "+994222563030",
    description: "Family-run kebab house on Ganja's pedestrian street with lula, tike and saj straight from the mangal.",
    cuisines: ["Azerbaijani", "Barbecue"], tags: ["Local dishes", "Halal"], features: ["Seating", "Takeout", "Outdoor Seating"],
    dietary: ["Halal"], moods: ["Family", "With friends"], dining: ["Lunch", "Dinner"],
    price: [15, 3, 30], hours: "classic", menu: "grillHouse", discount: 10, age: 90, hot: 3, rising: 1, quality: 0.85,
    covers: ["grill-plate", "feast-table"],
  },
  {
    key: "nizamiGarden", name: "Nizami Garden Cafe", city: "Ganja", hood: "Khan Garden, Kapaz",
    address: "Ataturk Ave. 4", coords: [46.3631, 40.6841], phone: "+994222551212",
    description: "Leafy cafe by Khan Garden with Ganja-style pakhlava, crepes and good coffee.",
    cuisines: ["Cafe", "Desserts", "Crepes"], tags: ["Vegan options"], features: ["Seating", "Outdoor Seating", "Wifi"],
    dietary: ["Vegetarian"], moods: ["Quiet", "Romantic"], dining: ["Breakfast", "Dessert"],
    price: [11, 4, 15], hours: "cafe", menu: "desserts", discount: 0, age: 65, hot: 2, rising: 0.8, quality: 0.9,
    covers: ["bright-room", "window-room"],
  },
  {
    key: "sumqayitGrill", name: "Sumqayit Seaside Grill", city: "Sumqayit", hood: "Seaside Boulevard",
    address: "Sulh str. 2", coords: [49.6317, 40.5855], phone: "+994186551919",
    description: "Grilled fish and meat on the Sumqayit boulevard, popular with families on summer evenings.",
    cuisines: ["Seafood", "Barbecue"], tags: ["Local dishes"], features: ["Accepts Credit Cards", "Seating", "Outdoor Seating", "Parking"],
    dietary: ["Halal", "Gluten free"], moods: ["Family"], dining: ["Lunch", "Dinner"],
    price: [34, 5, 70], hours: "lateWeekend", menu: "seafood", discount: 0, age: 75, hot: 3, rising: 0.9, quality: 0.7,
    covers: ["sea-terrace", "grill-plate"],
  },
  {
    key: "shakiCaravan", name: "Shaki Caravanserai Restaurant", city: "Shaki", hood: "Old town",
    address: "M. F. Akhundzade Ave. 185", coords: [47.1943, 41.2000], phone: "+994244444848",
    description: "Dine under 18th-century brick arches of the Upper Caravanserai: Shaki piti, halva and tea from the samovar.",
    cuisines: ["Azerbaijani"], tags: ["Local dishes", "Halal"], features: ["Seating", "Reservations", "Parking"],
    dietary: ["Halal", "Vegetarian"], moods: ["Family", "Romantic", "Quiet"], dining: ["Lunch", "Dinner"],
    price: [20, 3, 35], hours: "grill", menu: "azerbaijani", discount: 0, age: 120, hot: 3, rising: 1.2, quality: 0.95,
    covers: ["stone-vault", "shah-plov"],
  },
  {
    key: "qubaGarden", name: "Quba Apple Garden", city: "Quba", hood: "Qachrash",
    address: "Qachrash road 12", coords: [48.5130, 41.3610], phone: "+994233355050",
    description: "Orchard restaurant outside Quba with grilled trout, apple desserts and mountain herbs. Suspended while its hygiene certificate is renewed.",
    cuisines: ["Azerbaijani", "Healthy"], tags: ["Local dishes"], features: ["Seating", "Outdoor Seating", "Parking"],
    dietary: ["Vegetarian", "Organic"], moods: ["Family", "Quiet"], dining: ["Lunch", "Dinner"],
    price: [18, 4, 30], hours: "classic", menu: "grillHouse", discount: 0, age: 140, hot: 1, rising: 1, quality: 0.8,
    covers: ["green-salad", "feast-table"], status: "suspended",
    statusReason: "Hygiene certificate expired — suspended until the renewal is uploaded.",
  },
  {
    key: "greenBowl", name: "Green Bowl", city: "Baku", hood: "Sabail",
    address: "Nizami str. 12", coords: [49.8421, 40.3773], phone: "+994125001122",
    description: "Fresh salads, grain bowls and cold-pressed juices made to order.",
    cuisines: ["Healthy", "Vegan", "Cafe"], tags: ["Vegan options"], features: ["Accepts Credit Cards", "Seating", "Takeout"],
    dietary: ["Vegetarian", "Vegan", "Gluten free", "Organic"], moods: ["Quiet"], dining: ["Breakfast", "Lunch"],
    price: [16, 6, 25], hours: "cafe", menu: "healthy", discount: 0, age: 4, hot: 0, rising: 1, quality: 0.8,
    covers: ["green-salad", "salad-lunch"], status: "pending",
  },
  {
    key: "crepeCoffee", name: "Crepe & Coffee", city: "Baku", hood: "Torgovaya, Nasimi",
    address: "Rashid Behbudov str. 8", coords: [49.8424, 40.3727], phone: "+994125443355",
    description: "Sweet and savoury crepes with specialty coffee on the corner of Torgovaya street.",
    cuisines: ["Crepes", "Cafe", "Desserts"], tags: ["Trendy"], features: ["Seating", "Takeout", "Wifi"],
    dietary: ["Vegetarian"], moods: ["Quiet", "With friends"], dining: ["Breakfast", "Dessert"],
    price: [13, 4, 20], hours: "cafe", menu: "desserts", discount: 0, age: 2, hot: 0, rising: 1, quality: 0.8,
    covers: ["bright-room", "plated-fries"], status: "pending",
  },
  {
    key: "lankaranTea", name: "Lankaran Tea House", city: "Lankaran", hood: "City centre",
    address: "Hazi Aslanov str. 3", coords: [48.8510, 38.7540], phone: "+994252550707",
    description: "Tea house serving Lankaran black tea, lavangi and fresh citrus from the region.",
    cuisines: ["Cafe", "Azerbaijani"], tags: ["Local dishes"], features: ["Seating"],
    dietary: ["Vegetarian"], moods: ["Quiet"], dining: ["Breakfast", "Dessert"],
    price: [9, 2, 15], hours: "teaHouse", menu: "teaHouse", discount: 0, age: 8, hot: 0, rising: 1, quality: 0.8,
    covers: ["cozy-room"], status: "rejected",
    statusReason: "Duplicate listing — this tea house is already listed under a different name.",
  },
  {
    key: "oldBakuTavern", name: "Old Baku Tavern", city: "Baku", hood: "Icherisheher, Sabail",
    address: "Mirza Mansur str. 60", coords: [49.8342, 40.3657], phone: "+994124927878",
    description: "Former tavern in the Old City. Closed permanently and moved to Trash by the admin team.",
    cuisines: ["Azerbaijani"], tags: ["Local dishes"], features: ["Seating"],
    dietary: ["Halal"], moods: ["With friends"], dining: ["Dinner"],
    price: [22, 5, 40], hours: "classic", menu: "azerbaijaniSmall", discount: 0, age: 160, hot: 0, rising: 1, quality: 0.6,
    covers: ["library-room"], status: "closed", isDeleted: true,
    statusReason: "Closed permanently.",
  },
];

export { MENUS };

// ------------------------------------------------------------------ people

/**
 * Demo accounts. age = days since sign-up. invitedBy = key of the inviter.
 * settings override User.settings. email local part @yumio.app.
 */
export const USERS = [
  { key: "lala", firstName: "Lala", lastName: "Aliyeva", email: "lala@yumio.app", city: "Baku", verified: true, avatar: avatar("memoji-2"), bio: "Food blogger. Plov purist. Always hunting the best qutab in town.", phone: "+994501112233", age: 175, inviteCode: "LALAEATS", invitesSent: 6, cuisines: ["Azerbaijani", "Georgian", "Italian"], dietary: [], language: "en" },
  { key: "ali", firstName: "Ali", lastName: "Mammadov", email: "ali.m@yumio.app", city: "Baku", verified: true, avatar: avatar("memoji-1"), bio: "Steak, sushi and a good view — in that order.", phone: "+994502223344", age: 168, inviteCode: "ALIMAM26", invitesSent: 2, cuisines: ["Steakhouse", "Sushi", "Japanese"], dietary: [] },
  { key: "nigar", firstName: "Nigar", lastName: "Huseynova", email: "nigar@yumio.app", city: "Baku", verified: false, bio: "Weekend brunch hunter ☕", phone: "+994503334455", age: 150, cuisines: ["Cafe", "Healthy"], dietary: ["Vegetarian"], warnings: ["Off-topic review content"] },
  { key: "rashad", firstName: "Rashad", lastName: "Guliyev", email: "rashad@yumio.app", city: "Baku", verified: true, avatar: avatar("memoji-3"), bio: "Retired chef. I review honestly.", phone: "+994504445566", age: 162, cuisines: ["Azerbaijani", "Turkish", "Seafood"], dietary: ["Halal"] },
  { key: "aysel", firstName: "Aysel", lastName: "Karimova", email: "aysel@yumio.app", city: "Baku", verified: false, bio: "", phone: "+994505556677", age: 120, cuisines: ["Italian", "Pizza"], dietary: [] },
  { key: "jane", firstName: "Jane", lastName: "Doe", email: "jane@yumio.app", city: "Baku", verified: true, avatar: dish("creme-brulee"), bio: "Expat in Baku, eating my way through the Old City.", phone: "+994506667788", age: 140, cuisines: ["International", "Georgian"], dietary: ["Gluten free"] },
  { key: "john", firstName: "John", lastName: "Smith", email: "john@yumio.app", city: "Baku", verified: false, bio: "", phone: "+994507778899", age: 100, cuisines: ["Burger"], dietary: [], status: "suspended", statusReason: "Posting fake reviews", suspendDays: 7, warnings: ["Fake reviews on several restaurants"] },
  { key: "elvin", firstName: "Elvin", lastName: "Aliyev", email: "elvin@yumio.app", city: "Sumqayit", verified: false, bio: "", phone: "+994508889900", age: 90, cuisines: ["Fast Food"], dietary: [], status: "banned", statusReason: "Repeated policy violations", warnings: ["Inappropriate review content", "Spam in review comments"] },
  { key: "sabina", firstName: "Sabina", lastName: "Mammadli", email: "sabina@yumio.app", city: "Baku", verified: true, avatar: dish("garden-salad"), bio: "Plant-based and proud 🌱 Private account.", phone: "+994551112233", age: 130, cuisines: ["Vegan", "Healthy", "Asian"], dietary: ["Vegan", "Organic"], isPrivate: true, settings: { reviewsVisibility: "followers", listsVisibility: "followers" } },
  { key: "tural", firstName: "Tural", lastName: "Ismayilov", email: "tural@yumio.app", city: "Baku", verified: false, bio: "", phone: "+994552223344", age: 1, cuisines: ["Turkish"], dietary: [], status: "pending" },
  { key: "leyla", firstName: "Leyla", lastName: "Abbasova", email: "leyla@yumio.app", city: "Baku", verified: false, avatar: dish("thai-shrimp-salad"), bio: "Asian food addict.", phone: "+994553334455", age: 85, cuisines: ["Chinese", "Asian", "Japanese"], dietary: ["Dairy-free"] },
  { key: "kamran", firstName: "Kamran", lastName: "Rzayev", email: "kamran@yumio.app", city: "Baku", verified: true, avatar: DEFAULT_DISH.shashlik, bio: "Kebab critic. Mangal is life.", phone: "+994554445566", age: 110, cuisines: ["Barbecue", "Azerbaijani", "Steakhouse"], dietary: ["Halal"] },
  { key: "murad", firstName: "Murad", lastName: "Hasanov", email: "murad@yumio.app", city: "Ganja", verified: false, avatar: DEFAULT_DISH.platter, bio: "Ganja ↔ Baku. Always hungry.", phone: "+994555556677", age: 60, cuisines: ["Azerbaijani", "Barbecue"], dietary: ["Halal"], invitedBy: "lala" },
  { key: "gunel", firstName: "Günel", lastName: "Babayeva", email: "gunel@yumio.app", city: "Baku", verified: false, avatar: dish("cheesecake"), bio: "Desserts first.", phone: "+994556667788", age: 24, cuisines: ["Desserts", "Crepes", "Cafe"], dietary: ["Vegetarian"], invitedBy: "lala" },
  { key: "farid", firstName: "Farid", lastName: "Najafov", email: "farid@yumio.app", city: "Baku", verified: false, bio: "", phone: "+994557778899", age: 5, cuisines: ["Burger", "Fast Food"], dietary: [], invitedBy: "lala" },
  { key: "aynur", firstName: "Aynur", lastName: "Safarova", email: "aynur@yumio.app", city: "Sumqayit", verified: false, avatar: DEFAULT_DISH.sushi, bio: "Sushi on Fridays.", phone: "+994701112233", age: 45, cuisines: ["Sushi", "Seafood"], dietary: [], invitedBy: "ali" },
  { key: "orkhan", firstName: "Orkhan", lastName: "Jafarov", email: "orkhan@yumio.app", city: "Shaki", verified: false, bio: "Shaki halva ambassador.", phone: "+994702223344", age: 27, cuisines: ["Azerbaijani"], dietary: ["Halal"] },
  { key: "sevinj", firstName: "Sevinj", lastName: "Guliyeva", email: "sevinj@yumio.app", city: "Baku", verified: true, bio: "Date-night planner for my friends.", phone: "+994703334455", age: 95, cuisines: ["Italian", "Mediterranean", "International"], dietary: [], settings: { reviewsVisibility: "followers" } },
  { key: "emil", firstName: "Emil", lastName: "Hajiyev", email: "emil@yumio.app", city: "Baku", verified: false, avatar: DEFAULT_DISH.pizza, bio: "Pizza > everything.", phone: "+994704445566", age: 12, cuisines: ["Pizza", "Italian"], dietary: [], language: "az", settings: { listsVisibility: "me" } },
  { key: "nargiz", firstName: "Nargiz", lastName: "Ahmadova", email: "nargiz@yumio.app", city: "Baku", verified: false, avatar: dish("new-year-dumplings"), bio: "Dumplings in every city.", phone: "+994705556677", age: 3, cuisines: ["Chinese", "Georgian"], dietary: [], language: "ru", settings: { followerAlerts: false, emailNotifications: false } },
];

// Who follows whom (keys). Everyone not listed follows nobody.
export const FOLLOWS = {
  lala: ["ali", "rashad", "jane", "sabina", "leyla", "kamran", "murad", "gunel", "farid", "sevinj", "nigar", "aysel"],
  ali: ["lala", "rashad", "kamran", "aynur", "sevinj", "jane", "emil"],
  nigar: ["lala", "gunel", "sabina", "jane"],
  rashad: ["lala", "kamran", "orkhan", "ali", "murad"],
  aysel: ["lala", "emil", "sevinj", "nigar"],
  jane: ["lala", "ali", "sevinj", "leyla", "rashad"],
  john: ["lala", "ali"],
  elvin: ["farid"],
  sabina: ["lala", "leyla", "nigar"],
  leyla: ["lala", "sabina", "nargiz", "jane", "aynur"],
  kamran: ["rashad", "ali", "murad", "lala"],
  murad: ["lala", "kamran", "orkhan"],
  gunel: ["lala", "nigar", "sevinj"],
  farid: ["lala", "emil", "elvin"],
  aynur: ["ali", "leyla", "lala"],
  orkhan: ["rashad", "murad"],
  sevinj: ["lala", "jane", "aysel", "ali"],
  emil: ["aysel", "farid", "lala"],
  nargiz: ["leyla", "lala"],
};

// Custom favourite lists. items = restaurant keys; collaborators = [userKey, role];
// followers = users who saved the list to their collection.
export const LISTS = [
  { owner: "lala", name: "Best plov in Baku", privacy: "public", items: ["caravan", "firuze", "dolma", "shakiCaravan"], followers: ["jane", "murad", "gunel", "rashad", "ali"], age: 120 },
  { owner: "lala", name: "Date night favourites", privacy: "collaborative", items: ["whiteCity", "nero", "caspianGrill", "pastaBasta"], collaborators: [["sevinj", "editor"], ["jane", "viewer"]], followers: ["aysel"], age: 60 },
  { owner: "lala", name: "Weekend brunch spots", privacy: "public", items: ["brunchClub", "qutabChay", "nizamiGarden"], followers: ["nigar", "gunel"], age: 21 },
  { owner: "lala", name: "Try next", privacy: "private", items: ["tandoor", "sushiHouse", "anadoluDoner"], age: 9 },
  { owner: "ali", name: "The best sushi places in Baku", privacy: "public", items: ["sushiHouse", "chinaTown", "wokRoll"], followers: ["aynur", "leyla", "lala"], age: 90 },
  { owner: "ali", name: "Steak nights", privacy: "public", items: ["caspianGrill", "whiteCity", "sahil"], followers: ["kamran"], age: 45 },
  { owner: "rashad", name: "Honest Azerbaijani kitchens", privacy: "public", items: ["caravan", "firuze", "baskent", "ganjaKebab", "dolma"], followers: ["lala", "orkhan", "kamran", "murad"], age: 100 },
  { owner: "jane", name: "Old City walk", privacy: "collaborative", items: ["caravan", "qutabChay", "dolma"], collaborators: [["lala", "editor"], ["leyla", "editor"]], followers: ["sevinj"], age: 35 },
  { owner: "sabina", name: "Vegan-friendly", privacy: "public", items: ["brunchClub", "wokRoll", "chinaTown", "tandoor"], followers: ["leyla", "nigar"], age: 70 },
  { owner: "leyla", name: "Dumpling crawl", privacy: "collaborative", items: ["chinaTown", "mamaMeri", "wokRoll"], collaborators: [["nargiz", "editor"]], followers: ["lala", "jane"], age: 25 },
  { owner: "kamran", name: "Mangal masters", privacy: "public", items: ["ganjaKebab", "baskent", "caspianGrill", "sumqayitGrill"], followers: ["rashad", "murad"], age: 50 },
  { owner: "sevinj", name: "Romantic dinners", privacy: "private", items: ["whiteCity", "seaBreeze", "nero"], age: 40 },
  { owner: "gunel", name: "Sweet tooth", privacy: "public", items: ["nizamiGarden", "brunchClub", "pastaBasta"], followers: ["lala"], age: 14 },
  { owner: "emil", name: "Pizza ranking", privacy: "public", items: ["nero", "pastaBasta"], followers: ["aysel", "farid"], age: 20 },
  { owner: "murad", name: "Ganja eats", privacy: "public", items: ["ganjaKebab", "nizamiGarden"], followers: ["orkhan"], age: 30 },
  { owner: "farid", name: "Late-night food", privacy: "public", items: ["anadoluDoner", "burgerLab", "sahil", "mamaMeri"], followers: ["emil"], age: 6 },
];

// Restaurants each user follows ("🔔 Follow").
export const RESTAURANT_FOLLOWS = {
  lala: ["caravan", "chinaTown", "anadolu", "brunchClub", "mamaMeri", "qutabChay"],
  ali: ["caspianGrill", "sushiHouse", "whiteCity"],
  rashad: ["caravan", "firuze", "shakiCaravan"],
  jane: ["caravan", "nero", "mamaMeri"],
  leyla: ["chinaTown", "wokRoll", "sushiHouse"],
  kamran: ["ganjaKebab", "caspianGrill", "anadolu"],
  sabina: ["brunchClub", "wokRoll"],
  gunel: ["nizamiGarden", "brunchClub"],
  farid: ["burgerLab", "anadoluDoner"],
  aynur: ["sushiHouse", "sumqayitGrill"],
  sevinj: ["nero", "whiteCity", "pastaBasta"],
  emil: ["nero", "pastaBasta"],
  nargiz: ["chinaTown", "mamaMeri"],
  murad: ["ganjaKebab"],
  orkhan: ["shakiCaravan"],
  aysel: ["nero", "pastaBasta", "anadolu"],
  nigar: ["brunchClub"],
};

// ---------------------------------------------------------------- texts

export const REVIEW_TEXT = {
  liked: [
    "The {dish} was the highlight — perfectly cooked and generous.",
    "Lovely atmosphere and friendly staff. We'll be back for the {dish}.",
    "One of the best spots in {city}. The {dish} alone is worth the trip.",
    "Came for a quick lunch and stayed two hours. Try the {dish}!",
    "Everything was fresh and the service was spot on.",
    "Perfect for a date night — quiet corner table and a great {dish}.",
    "Portions are huge and prices are fair. Loved the {dish}.",
    "Brought my parents here and they loved it. Book ahead on weekends.",
  ],
  fine: [
    "Decent {dish}, but the service was slow on a busy Friday.",
    "Good food, a bit overpriced for what you get.",
    "Nice place, although the music was too loud for a conversation.",
    "The {dish} was fine, nothing special. Desserts were better.",
    "Okay for a quick bite; I expected more from the reviews.",
  ],
  disliked: [
    "We waited 40 minutes for the {dish} and it arrived cold.",
    "Disappointing — the {dish} was over-salted and the table was sticky.",
    "Staff seemed uninterested and the bill had items we didn't order.",
    "Not what the photos promise. Wouldn't come back, unfortunately.",
  ],
};

export const COMMENT_TEXT = [
  "Totally agree, the {dish} there is unreal!",
  "Adding this to my list 🙌",
  "Was it busy on the weekend?",
  "Thanks for the tip, going this Friday.",
  "Did you book in advance?",
  "Their terrace is even better in summer.",
  "Hmm, my experience was different, but glad you liked it.",
  "Great photos! What did you drink with it?",
];

export const REPLY_TEXT = [
  "yes, book a day ahead — it fills up fast.",
  "we went on Saturday around 8, had to wait 10 minutes.",
  "try the {dish} next time!",
  "fair point, maybe it was an off night.",
  "just the house lemonade, highly recommend.",
];

export const SEARCHES = [
  { type: "query", label: "plov" },
  { type: "query", label: "sushi near me" },
  { type: "query", label: "rooftop dinner" },
  { type: "query", label: "brunch" },
  { type: "query", label: "khinkali" },
  { type: "cuisine", label: "Italian", subtitle: "Cuisine" },
  { type: "cuisine", label: "Georgian", subtitle: "Cuisine" },
  { type: "mood", label: "Romantic", subtitle: "Mood" },
  { type: "mood", label: "With friends", subtitle: "Mood" },
  { type: "dish", label: "Dolma", subtitle: "Dish" },
  { type: "dish", label: "Margherita pizza", subtitle: "Dish" },
  { type: "place", label: "Fountain Square", subtitle: "Nasimi, Baku", coordinates: [49.8370, 40.3700] },
  { type: "place", label: "Icherisheher", subtitle: "Sabail, Baku", coordinates: [49.8338, 40.3664] },
];

export const LABEL_REQUESTS = [
  { user: "lala", label: "Live music", group: "Good for", status: "pending" },
  { user: "jane", label: "Pet friendly", group: "Good for", status: "pending" },
  { user: "gunel", label: "Kids menu", group: "Good for", status: "pending" },
  { user: "ali", label: "Great view", group: "Good for", status: "approved", adminNote: "Already in the catalog — linked to the existing label." },
  { user: "farid", label: "Hookah", group: "Good for", status: "rejected", adminNote: "We don't list tobacco-related labels." },
  { user: "rashad", label: "Too salty", group: "What was wrong?", status: "rejected", adminNote: "Covered by the existing “Bad Food” label." },
];

// Reports: target = "review:<n>" (nth seeded review of a status), "restaurant:<key>", "user:<key>", "list:<n>".
export const REPORTS = [
  { target: "review:flagged:0", reporter: "rashad", reason: "Fake review", description: "This account posts the same text on several restaurants.", status: "open", daysAgo: 1 },
  { target: "review:flagged:1", reporter: "lala", reason: "Offensive language", description: "Insulting wording towards the staff.", status: "open", daysAgo: 2 },
  { target: "review:approved:3", reporter: "kamran", reason: "Not a real visit", description: "The restaurant was closed on the date mentioned.", status: "in_review", daysAgo: 4 },
  { target: "review:approved:7", reporter: "jane", reason: "Spam / advertising", description: "Mentions a promo code for another place.", status: "resolved", action: "none", note: "Checked — no promotional content found, the review stays.", daysAgo: 12 },
  { target: "review:rejected:0", reporter: "ali", reason: "Inappropriate", description: "Personal attack on a waiter.", status: "resolved", action: "hide_review", note: "Review hidden for breaking the community guidelines.", daysAgo: 20 },
  { target: "restaurant:seaBreeze", reporter: "sevinj", reason: "Incorrect information", description: "They are closed for renovation, but the app says open.", status: "open", daysAgo: 3 },
  { target: "restaurant:baskent", reporter: "murad", reason: "Incorrect information", description: "Opening hours on Sunday are wrong.", status: "in_review", daysAgo: 6 },
  { target: "restaurant:oldBakuTavern", reporter: "rashad", reason: "Closed permanently", description: "This place shut down last month.", status: "resolved", note: "Listing moved to Trash.", daysAgo: 30 },
  { target: "user:john", reporter: "aysel", reason: "Fake account", description: "Suspected bot posting many reviews in one evening.", status: "resolved", note: "Account suspended for 7 days.", daysAgo: 8 },
  { target: "user:elvin", reporter: "farid", reason: "Spam account", description: "Keeps sending me links in comments.", status: "open", daysAgo: 5 },
  { target: "list:5", reporter: "nigar", reason: "Spam / advertising", description: "List name looks like an ad.", status: "dismissed", note: "Nothing wrong with the list.", daysAgo: 15 },
];

// Admin broadcast every active demo user received.
export const BROADCAST = {
  title: "Welcome to Yumio",
  message: "Discover the places your friends love, save favourites into lists and share your honest reviews.",
};
