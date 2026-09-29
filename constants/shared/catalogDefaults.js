/**
 * First-boot defaults for the admin-managed catalog and content.
 *
 * CatalogService.ensureDefaults() inserts these once; after that the database
 * is the source of truth and the admin edits it in the panel. Nothing else
 * should import this file for validation or output — read the Taxonomy /
 * City / Faq / ContentPage / OnboardingSlide / Settings collections instead.
 *
 * The texts are copied from what the mobile app used to hardcode so that
 * nothing visible changes when the lists move to the API.
 * Intentionally NOT re-exported from the #constants barrel.
 */

// ----- Taxonomies -----

// Figma Preference (1:12697) chips — the curated onboarding options
// (Taxonomy.showInOnboarding). The design's "Seafood platter" is the Seafood
// cuisine and "Vegetarian dishes" / "Vegan dishes" / "Organic food" are the
// Vegetarian / Vegan / Organic dietary items restaurants are tagged with.
const ONBOARDING_CUISINES = [
  "Pizza",
  "Sushi",
  "Burger",
  "Seafood",
  "Barbecue",
  "Cheeseburger",
  "Crepes",
  "Italian",
  "Vegan",
  "Asian",
  "Healthy",
  "Desserts",
];
const ONBOARDING_DIETARY = ["Vegetarian", "Gluten free", "Vegan", "Halal", "Organic", "Dairy-free"];
// Figma chip label → catalog name, for the one-off flagging of existing items.
const ONBOARDING_ALIASES = {
  "Seafood platter": "Seafood",
  "Vegetarian dishes": "Vegetarian",
  "Vegan dishes": "Vegan",
  "Organic food": "Organic",
};

// Former server enum `cuisineTypes` followed by the Figma onboarding preference
// list ("Seafood platter" merged into "Seafood"), in the Figma Home rail order.
const DEFAULT_CUISINES = [
  // Figma Home "Cuisines" chips first, in the design's order.
  { name: "International", emoji: "🌍" },
  { name: "Turkish", emoji: "🥙" },
  { name: "Chinese", emoji: "🥡" },
  { name: "Fast Food", emoji: "🍟" },
  { name: "Seafood", emoji: "🦐" },
  { name: "Italian", emoji: "🍝" },
  { name: "Japanese", emoji: "🍱" },
  { name: "Azerbaijani", emoji: "🍢" },
  { name: "Indian", emoji: "🍛" },
  { name: "Cafe", emoji: "☕" },
  { name: "Vegan", emoji: "🌱" },
  { name: "Steakhouse", emoji: "🥩" },
  { name: "Georgian", emoji: "🥟" },
  { name: "Mediterranean", emoji: "🫒" },
  { name: "Pizza", emoji: "🍕" },
  { name: "Sushi", emoji: "🍣" },
  { name: "Burger", emoji: "🍔" },
  { name: "Barbecue", emoji: "🍖" },
  { name: "Cheeseburger", emoji: "🧀" },
  { name: "Crepes", emoji: "🥞" },
  { name: "Asian", emoji: "🍜" },
  { name: "Healthy", emoji: "🥗" },
  { name: "Desserts", emoji: "🍰" },
].map((c) => ({ ...c, showOnHome: true, showInOnboarding: ONBOARDING_CUISINES.includes(c.name) }));

// Former server enum `restaurantFeatures` + the Ionicons map from the mobile
// restaurant "More" tab.
const DEFAULT_FEATURES = [
  { name: "Accepts Credit Cards", icon: "card-outline" },
  { name: "Seating", icon: "people-outline" },
  { name: "Reservations", icon: "calendar-outline" },
  { name: "Takeout", icon: "bag-handle-outline" },
  { name: "Delivery", icon: "bicycle-outline" },
  { name: "Parking", icon: "car-outline" },
  { name: "Wifi", icon: "wifi-outline" },
  { name: "Outdoor Seating", icon: "sunny-outline" },
];

// Card label chips (existing restaurant tags are imported on top of these).
const DEFAULT_TAGS = [
  { name: "Local dishes" },
  { name: "Trendy" },
  { name: "Halal" },
  { name: "Vegan options" },
];

const DEFAULT_DIETARY = [
  { name: "Vegetarian" },
  { name: "Gluten free" },
  { name: "Vegan" },
  { name: "Halal" },
  { name: "Organic" },
  { name: "Dairy-free" },
].map((d) => ({ ...d, showInOnboarding: ONBOARDING_DIETARY.includes(d.name) }));

const DEFAULT_MOODS = [
  { name: "With friends", icon: "people-outline" },
  { name: "Family", icon: "home-outline" },
  { name: "Romantic", icon: "heart-outline" },
  { name: "Trendy", icon: "flame-outline" },
  { name: "Quiet", icon: "moon-outline" },
];

const DEFAULT_REPORT_REASONS = [
  { name: "Spam / advertising" },
  { name: "Offensive language" },
  { name: "Incorrect information" },
  { name: "Closed permanently" },
  { name: "Fake account" },
  { name: "Not a real visit" },
  // Reasons shown in the admin Reports design.
  { name: "Fake review" },
  { name: "Spam account" },
  { name: "Inappropriate" },
];

// Review composer "Labels & dishes" sheet — `group` is the section heading.
const DEFAULT_REVIEW_LABELS = [
  ...[
    "Atmosphere",
    "Bottomless Brunch",
    "Cash only",
    "Casual dinner",
    "Cheap eats",
    "Cocktails",
    "Coffee",
    "Dessert",
    "Good for dates",
    "Family friendly",
    "Business lunch",
    "Great view",
  ].map((name) => ({ name, group: "Good for" })),
  ...[
    "Bad Ambiance",
    "Bad Food",
    "Bad music",
    "Bad service",
    "Expensive",
    "Hard to reserve",
    "Limited options",
    "Limited seating",
    "Long wait",
    "Noisy",
  ].map((name) => ({ name, group: "What was wrong?" })),
];

// Filter screen "Dining options" chips (Figma Filter 1:15166).
const DEFAULT_DINING = [
  { name: "Breakfast", icon: "cafe-outline" },
  { name: "Dessert", icon: "ice-cream-outline" },
  { name: "Lunch", icon: "fast-food-outline" },
  { name: "Dinner", icon: "restaurant-outline" },
  { name: "Brunch", icon: "sunny-outline" },
  { name: "Seating", icon: "people-outline" },
  { name: "Catering", icon: "gift-outline" },
];

// type → default items (order = array index).
const DEFAULT_TAXONOMIES = {
  cuisine: DEFAULT_CUISINES,
  feature: DEFAULT_FEATURES,
  tag: DEFAULT_TAGS,
  dietary: DEFAULT_DIETARY,
  mood: DEFAULT_MOODS,
  reportReason: DEFAULT_REPORT_REASONS,
  reviewLabel: DEFAULT_REVIEW_LABELS,
  dining: DEFAULT_DINING,
};

// Round food photos of the Home "Cuisines" chips (Figma Home 1:12864), exported
// into the served, git-tracked uploads/catalog/defaults/ folder. Applied once
// per cuisine slug, and only while the item has no image of its own.
const DEFAULT_CUISINE_IMAGES = {
  international: "uploads/catalog/defaults/cuisines/international.jpg",
  turkish: "uploads/catalog/defaults/cuisines/turkish.png",
  chinese: "uploads/catalog/defaults/cuisines/chinese.png",
  "fast-food": "uploads/catalog/defaults/cuisines/fast-food.png",
  seafood: "uploads/catalog/defaults/cuisines/seafood.png",
  italian: "uploads/catalog/defaults/cuisines/italian.png",
  japanese: "uploads/catalog/defaults/cuisines/japanese.jpg",
};

// Fallback photos of the "Trending now" collage tile when too few trending
// restaurants have photos (Figma mediaItem 1:12916).
const DEFAULT_TRENDING_COLLAGE = [
  "uploads/catalog/defaults/recommends/trending-1.jpg",
  "uploads/catalog/defaults/recommends/trending-2.jpg",
  "uploads/catalog/defaults/recommends/trending-3.jpg",
  "uploads/catalog/defaults/recommends/trending-4.jpg",
];

// ----- Cities (mobile location sheet; Baku is the default) -----
const DEFAULT_CITIES = [
  { name: "Baku", latitude: 40.4093, longitude: 49.8671, isDefault: true },
  { name: "Ganja", latitude: 40.6828, longitude: 46.3606 },
  { name: "Sumqayit", latitude: 40.5897, longitude: 49.6686 },
  { name: "Shaki", latitude: 41.1919, longitude: 47.1706 },
  { name: "Quba", latitude: 41.3625, longitude: 48.5128 },
  { name: "Lankaran", latitude: 38.7529, longitude: 48.8475 },
  { name: "Shamakhi", latitude: 40.6319, longitude: 48.6414 },
  { name: "Naxchivan", latitude: 39.2091, longitude: 45.4122 },
].map((c) => ({ country: "Azerbaijan", label: `${c.name}, Azerbaijan`, ...c }));

// ----- Help & support FAQ -----
const DEFAULT_FAQS = [
  {
    question: "How do ratings work?",
    answer:
      "Instead of stars, you rate a visit with a reaction — Liked it, It was fine, or Didn't like it. We combine everyone's reactions into the restaurant's overall score.",
  },
  {
    audience: "app",
    question: "How do I save a restaurant?",
    answer:
      "Tap the heart on any restaurant card or profile. It goes into your private Saved list — you can also create your own lists and share them with friends.",
  },
  {
    question: "What are collaborative lists?",
    answer:
      "A collaborative list can be edited by anyone you share it with — perfect for planning dinners with friends. You can change a list's privacy any time.",
  },
  {
    question: "How does Surprise me work?",
    answer:
      "Surprise me picks one random open restaurant near you, based on your area. Don't like the pick? Spin again — we won't repeat suggestions.",
  },
  {
    audience: "app",
    question: "How do I change my password?",
    answer:
      'Go to Profile → Personal details → Change password. If you forgot it, use "Forgot password?" on the login screen.',
  },
];

// ----- Website-only FAQ (landing page), shown together with the "both" FAQs -----
const DEFAULT_WEB_FAQS = [
  {
    audience: "web",
    order: -1,
    question: "What is Yumio?",
    answer:
      "Yumio is a restaurant discovery app for finding the best places to eat around you — powered by a map, honest reactions from real visitors, and recommendations from friends you follow.",
  },
  {
    audience: "web",
    order: 99,
    question: "Is Yumio free?",
    answer: "Yes — discovering restaurants, writing reviews, and building lists are all completely free.",
  },
];

// ----- Legal pages -----
// Privacy / Cookies copy from the Figma (Profile_Privacy Settings 1:14306,
// Profile_Cookies Policy 1:14350) in the app's Legal markup: "> " note box,
// "| a | b |" table rows, a block of [label](url) links (store links render as
// badges). {appLinks.ios} / {appLinks.android} are filled from Settings.appLinks
// by GET /content/pages/:slug; a link whose URL is empty is left out.
const section = ([heading, body]) => ({ heading, body, highlight: false });

const DEFAULT_PAGES = [
  {
    slug: "terms",
    title: "Terms of use",
    sections: [
      ["1. About Yumio", "Yumio helps you discover restaurants and places around you, read and share honest reviews, and plan visits with friends. By using the app you agree to these terms."],
      ["2. Your account", "You are responsible for keeping your credentials safe. You must provide accurate information and be at least 13 years old to use Yumio."],
      ["3. Reviews & user content", "Reviews must reflect your genuine experience. Spam, advertising, offensive language and fake reviews are removed and may lead to account suspension. By posting content you grant Yumio a licence to display it in the app."],
      ["4. Restaurant information", "Ratings are aggregated from user reactions. Opening hours, prices and menus are provided by restaurants or the community and may change without notice."],
      ["5. Termination", "We may suspend accounts that violate these terms. You can delete your account at any time by contacting support."],
    ].map(section),
  },
  {
    slug: "privacy",
    title: "Privacy Settings",
    sections: [
      ["Terms of Use", "By using Yumio, you agree to these terms. Yumio grants you a limited, non-exclusive, non-transferable license to access and use the platform for personal, non-commercial purposes.\n\nYou must not misuse our services, attempt to access them using methods other than the provided interface, or use them for any unlawful purpose."],
      ["What is Yumio?", "Yumio is a food discovery platform that helps you find restaurants, cafes, and dining spots that match your personal taste and mood.\n\nYumio does not operate restaurants or take reservations. We connect people with places through community-driven content, reviews, and curated lists.\n\n> Yumio is a discovery tool — not a booking or delivery service. Our goal is to help you find your perfect place to eat."],
      ["Reviews & User Content", "When you submit a review or list, you grant Yumio a worldwide, royalty-free license to use, display, and distribute that content on the platform.\n\nYou are solely responsible for the accuracy of your reviews. Yumio does not verify reviews but reserves the right to remove content that violates our community guidelines.\n\n> Reviews must be honest and based on genuine experience. Fake or incentivized reviews are strictly prohibited."],
      ["Restaurant Ratings", "Ratings on Yumio are calculated based on aggregated user reviews. No restaurant can pay to alter or improve their rating.\n\nRatings are updated in real time as new reviews are submitted. A restaurant's overall score reflects the average of all verified user ratings."],
      ["Your Data & Rights", "You have the right to access, correct, or delete your personal data at any time. You can download a copy of your data from Profile → Settings → Download my data.\n\nWe do not sell your personal data to third parties. Data is used solely to improve your Yumio experience."],
    ].map(section),
  },
  {
    slug: "cookies",
    title: "Cookies Policy",
    sections: [
      ["What are cookies?", "Cookies are small text files stored on your device when you visit Yumio. They help us remember your preferences, keep you signed in, and understand how you use our platform.\n\nYumio uses both first-party cookies (set by us) and third-party cookies (set by partners like analytics services)."],
      ["Interest-based advertising", "Yumio may use cookies to show you relevant content based on your browsing behaviour and food preferences. This is called interest-based or behavioural advertising.\n\nYou can opt out of interest-based advertising at any time from your device settings or through our cookie preferences panel.\n\n> Yumio does not sell your personal data to advertisers. Ads are matched based on your in-app interests only."],
      ["Types of cookies", "| Type | Purpose |\n|---|---|\n| Essential | Login, security, core features |\n| Analytics | Usage stats, performance |\n| Preference | Language, theme, filters |\n| Marketing | Interest-based content |"],
      ["Mobile devices", "On mobile, cookies work differently. Yumio uses device identifiers (IDFA on iOS, GAID on Android) instead of browser cookies to personalise your experience.\n\nYou can reset or limit ad tracking directly from your device settings."],
      ["Download Yumio", "Get Yumio on your device and manage all cookie preferences directly in the app.\n\n[Google Play]({appLinks.android}) [App Store]({appLinks.ios})"],
    ].map(section),
  },
];

// ----- Onboarding carousel -----
// The three Figma slides (Onboarding 1–3: 1:12543, 1:12561, 1:12647). Slides
// without an uploaded image use the app's bundled Figma art by position.
const DEFAULT_ONBOARDING = [
  {
    icon: "restaurant",
    title: "Discover your next favourite restaurant",
    subtitle:
      "Find the best spots around you — from hidden gems to crowd favourites, all in one place.",
  },
  {
    icon: "heart",
    title: "Save the places you love",
    subtitle:
      "Create your own lists, organise favourites and revisit your best dining experiences anytime.",
  },
  {
    icon: "people",
    title: "Share lists with friends & family",
    subtitle:
      "Plan meals together, share your favourite spots and discover what the people you trust recommend.",
  },
];

// ----- Settings singleton (app config served by GET /api/catalog) -----
const DEFAULT_SETTINGS = {
  supportPhone: "",
  companyAddress: "Baku, Azerbaijan",
  supportReplyNote: "We usually reply within a day.",
  timezone: "Asia/Baku",
  filters: {
    distanceOptions: [500, 1500, 8000], // metres ("Any" is implicit)
    ratingOptions: [3.5, 4, 4.5],
    reviewCountOptions: [50, 300, 1000],
    priceMin: 0, // ₼ avg-price slider
    priceMax: 150,
    priceStep: 5,
    defaultRadius: 20000, // metres, Home "Near you" / Surprise me
    maxRadius: 50000, // metres, largest radius; also the Home area scope
    // Optional display label per distance option, keyed by metres ("1500": "1 mile").
    // Empty → clients format the metres themselves.
    distanceLabels: {},
  },
  // Travel-time estimate shown on cards ("1h 30 min"): straight-line distance ×
  // roadFactor at speedKmh.
  eta: {
    speedKmh: 5,
    roadFactor: 1.25,
  },
  quickFilters: {
    distance: [1500, 5000],
    rating: [4, 4.5],
    price: [25, 60],
  },
  // "Sort by" sheet (Figma 1:15190) in order; `description` is the (?) dialog copy
  // (1:15191-1:15196), rewritten where the Figma text describes features Yumio
  // does not have (bookings, table availability).
  sortOptions: [
    {
      key: "relevance",
      label: "Relevance",
      isActive: true,
      description:
        "Relevance ranks restaurants based on your search and several criteria: how well they match what you typed, special offers, average rating, distance to the address you entered and how popular they are on Yumio right now.",
    },
    {
      key: "rating",
      label: "Average rating",
      isActive: true,
      description:
        "Average rating sorting ranks restaurants according to the average rating given by diners. From the highest average rating to the lowest.",
    },
    {
      key: "popularity",
      label: "Popularity",
      isActive: true,
      description:
        "Popularity sorting ranks restaurants according to how many diners viewed, saved and reviewed them on Yumio over the last 7 days. From the most popular restaurant to the least popular.",
    },
    {
      key: "top_rated_month",
      label: "Top rated this month",
      isActive: true,
      description:
        "Top rated this month displays restaurants with the highest rating to the lowest rating (according to the average rating given by diners) over the past 30 days.",
    },
    {
      key: "price_asc",
      label: "Price",
      isActive: true,
      description:
        "Price sorting ranks restaurants from the cheapest to the most expensive (according to the average price displayed on the restaurant page).",
    },
    {
      key: "newest",
      label: "New restaurants",
      isActive: true,
      description:
        "New restaurants sorting ranks restaurants according to the date of their first publication on Yumio. From the most recent publication date to the oldest.",
    },
    {
      key: "trending_month",
      label: "Trending this month",
      isActive: false,
      description:
        "Trending this month ranks restaurants by how much diners viewed, saved and reviewed them over the past 30 days.",
    },
    {
      key: "distance",
      label: "Distance",
      isActive: false,
      description:
        "Distance sorting ranks restaurants from the closest to the farthest from the address you entered.",
    },
    {
      key: "saved",
      label: "Most saved",
      isActive: false,
      description: "Most saved sorting ranks restaurants by how many diners saved them to their lists.",
    },
    {
      key: "price_desc",
      label: "Price: high to low",
      isActive: false,
      description:
        "Ranks restaurants from the most expensive to the cheapest (according to the average price displayed on the restaurant page).",
    },
    {
      key: "most_saved_month",
      label: "Most saved this month",
      isActive: false,
      description: "Display the most saved restaurants over the past 30 days.",
    },
    {
      key: "on_the_rise",
      label: "On the rise",
      isActive: false,
      description: "Discover which restaurants are quickly becoming favorites among Yumio diners.",
    },
  ].map((o, order) => ({ ...o, order })),
  // "Trending this month" sheet (Figma 1:15210). Yumio has no bookings, so the
  // design's "Most booked this month" ranks by saves instead.
  trendingOptions: [
    {
      key: "most_saved_month",
      label: "Most saved this month",
      description: "Display the most saved restaurants over the past 30 days.",
    },
    {
      key: "top_rated_month",
      label: "Top rated this month",
      description: "Display the restaurants with the highest rating over the past 30 days.",
    },
    {
      key: "on_the_rise",
      label: "On the rise",
      description: "Discover which restaurants are quickly becoming favorites among Yumio diners.",
    },
  ].map((o, order) => ({ ...o, isActive: true, order })),
  // Home "Recommends" / Search "Popular also search for" tiles (Figma 1:12916-18).
  // image null → trending shows a collage of trending restaurants' photos.
  recommendations: [
    {
      key: "trending",
      title: "Trending now",
      description: "Restaurants diners viewed, saved and reviewed the most this month.",
      image: null,
    },
    {
      key: "bestRated",
      title: "Best Rated",
      description: "Restaurants with the highest average rating.",
      image: "uploads/catalog/defaults/recommends/best-rated.jpg",
    },
    {
      key: "friendPicks",
      title: "Friend Picks",
      description: "Restaurants the people you follow saved and liked.",
      image: "uploads/catalog/defaults/recommends/friend-picks.jpg",
    },
  ].map((o, order) => ({ ...o, isActive: true, order })),
  // maxPrice = exclusive upper bound of the level's average-price band (₼);
  // Restaurant.priceLevel is derived from avgPrice with these bands.
  priceLevels: [
    { key: "$", label: "₼", hint: "Budget", maxPrice: 15 },
    { key: "$$", label: "₼₼", hint: "Moderate", maxPrice: 35 },
    { key: "$$$", label: "₼₼₼", hint: "Upscale", maxPrice: 70 },
    { key: "$$$$", label: "₼₼₼₼", hint: "Fine dining", maxPrice: null },
  ],
  // Figma Profile_Setting (1:14194): "Email Notification" group, then the
  // "Push Notification" group (reservations, new follower alerts). The push
  // master switch has no Figma row of its own and comes last.
  notificationOptions: [
    { key: "emailNotifications", label: "Receive new follower emails", description: "" },
    { key: "reservationAlerts", label: "Receive information about my reservations", description: "" },
    {
      key: "followerAlerts",
      label: "Receive new follower alerts",
      description:
        "Receive push notifications for your bookings, updates from your favorite restaurants, promotions, followers, and other news from Yumio.",
    },
    { key: "pushNotifications", label: "Receive push notifications", description: "" },
  ],
  sentiments: [
    { key: "liked", label: "Liked it", emoji: "😊", color: "#22C55E" },
    { key: "fine", label: "It was fine", emoji: "🙂", color: "#FFCC00" },
    { key: "disliked", label: "Didn't like it", emoji: "☹️", color: "#EC221F" },
  ],
  surprise: {
    title: "Surprise me",
    loadingTitle: "Finding your perfect spot",
    loadingSubtitle: "We're picking the best restaurants based on your preferences.",
    emptyTitle: "We're sorry, we couldn't find other results in this area",
    emptySubtitle:
      "Try again in another area to see more results or try a suggested search below.",
    emptyCta: "Return to Home",
    foundTitle: "We found the perfect spot for you.",
    againCta: "Surprise me again",
    exploreCta: "Explore this place",
    // Under the result when it matched the user's food preferences.
    preferencesNote: "Picked based on your preferences.",
  },
  // Store listings (https URLs, "" = not published yet): landing page download
  // buttons, the Cookies page store badges.
  appLinks: { ios: "", android: "" },
  // App versions ("1.4.0"; "" = no check): below minSupported the app must
  // update (force-update screen, API calls answer 426 APP_UPDATE_REQUIRED);
  // below latest it may offer a soft update.
  appVersion: { minSupported: "", latest: "" },
  // Feed "Invite friends 0/3" card: friends to invite (1–20).
  inviteGoal: 3,
  homeSections: [
    { key: "cuisines", title: "Cuisines", limit: 30 },
    { key: "nearYou", title: "Near you", limit: 10 },
    // {maxDiscount} is replaced server-side with the real max discountPercent.
    { key: "discounted", title: "Up to {maxDiscount}% off", ctaLabel: "See more", limit: 10 },
    // Signed-in users' viewing history (guests keep theirs on the device).
    { key: "recentlyViewed", title: "Recently viewed", ctaLabel: "Clear", limit: 10 },
    // Tiles of Settings.recommendations; `limit` = how many tiles.
    { key: "recommends", title: "Recommends", ctaLabel: "See more", limit: 3 },
    {
      key: "topWeek",
      title: "Top restaurants this week",
      subtitle: "Explore what's popular with other diners with these lists, updated weekly.",
      tabLabels: ["Top viewed", "Top saved"],
      limit: 5,
    },
    {
      key: "surprise",
      title: "Not sure where to eat? We got you.",
      ctaLabel: "Surprise me",
      limit: 1,
    },
  ].map((s, order) => ({
    subtitle: "",
    ctaLabel: "",
    tabLabels: [],
    isActive: true,
    ...s,
    order,
  })),
};

// Legal pages as first seeded; ensureDefaults() replaces a page with the Figma
// copy above only while it still equals this (admin edits are kept).
const LEGACY_PAGES = [
  {
    slug: "privacy",
    title: "Privacy policy",
    sections: [
      ["1. What we collect", "Your account details (name, email, phone), the content you create (reviews, photos, lists), and app activity such as saved restaurants and searches."],
      ["2. Location", "Your approximate location is used only to show nearby restaurants and distances. It is never shared with other users."],
      ["3. What other users see", "Your name, avatar, reviews and public lists are visible to other users. Private lists and your email are never shown."],
      ["4. Your rights", "You can update your details in Personal details, control visibility in Activity visibility, clear your search history, or request account deletion via support."],
      ["5. Data security", "Passwords are stored hashed, traffic is encrypted, and photos you upload are stored on our servers only."],
    ].map(section),
  },
  {
    slug: "cookies",
    title: "Cookies policy",
    sections: [
      ["1. What are cookies?", "Small pieces of data used to keep you signed in and remember your preferences. In the mobile app we use secure on-device storage for the same purpose."],
      ["2. What we store on your device", "Your session tokens, onboarding state, food preferences and recent searches — all locally, to make the app faster and personal."],
      ["3. Analytics", "We collect anonymous usage statistics (screens visited, feature usage) to improve Yumio. No personal data is sold to third parties."],
      ["4. Managing storage", "You can clear search history in Settings, and logging out removes your session data from the device."],
    ].map(section),
  },
];

/**
 * Values earlier releases seeded that the Figma pass changed. ensureSettings()
 * replaces a stored value only while it still equals the old default, so admin
 * edits are never overwritten.
 */
const LEGACY_SETTINGS = {
  // Cuisine order as first seeded (reordered to the Figma rail once, if untouched).
  cuisineOrder: [
    "International",
    "Turkish",
    "Chinese",
    "Italian",
    "Azerbaijani",
    "Japanese",
    "Indian",
    "Fast Food",
    "Seafood",
    "Cafe",
    "Vegan",
    "Steakhouse",
    "Georgian",
    "Mediterranean",
  ],
  // Onboarding slides as first seeded (by position); the Figma pass replaces
  // slides 2–3 and switches slide 4 off while they are still untouched.
  onboarding: [
    {
      icon: "restaurant",
      title: "Discover your next favourite restaurant",
      subtitle:
        "Find the best spots around you — from hidden gems to crowd favourites, all in one place.",
    },
    {
      icon: "map",
      title: "Explore places on the map",
      subtitle: "See what's nearby, check what's open, and plan where to go next.",
    },
    {
      icon: "heart",
      title: "Save & share your favorites",
      subtitle: "Build lists, follow friends and never lose track of a great spot again.",
    },
    {
      icon: "sparkles",
      title: "Not sure where to eat?",
      subtitle: "Spin the wheel and let Yumio surprise you with the perfect pick.",
    },
  ],
  // Notification switch copy as first seeded (key → { label, description }).
  notificationOptions: {
    emailNotifications: { label: "Email notifications", description: "News, tips and account updates by email" },
    pushNotifications: { label: "Push notifications", description: "Activity on your reviews and lists" },
    followerAlerts: { label: "Follower alerts", description: "When someone follows you" },
  },
  "surprise.emptySubtitle": "Try again later, or explore restaurants on the map instead.",
  "filters.reviewCountOptions": [100, 500, 1000],
  "homeSections.topWeek.subtitle": "Explore what's popular with other diners, updated weekly.",
  // The whole sort list as first seeded (key, label, isActive, order).
  sortOptions: [
    { key: "distance", label: "Distance", isActive: true },
    { key: "rating", label: "Rating", isActive: true },
    { key: "popularity", label: "Popularity", isActive: true },
    { key: "newest", label: "Newest", isActive: true },
    { key: "saved", label: "Most saved", isActive: false },
    { key: "price_asc", label: "Price: low to high", isActive: false },
    { key: "price_desc", label: "Price: high to low", isActive: false },
  ].map((o, order) => ({ ...o, order })),
};

export {
  DEFAULT_CUISINES,
  DEFAULT_FEATURES,
  DEFAULT_TAGS,
  DEFAULT_DIETARY,
  DEFAULT_MOODS,
  DEFAULT_REPORT_REASONS,
  DEFAULT_REVIEW_LABELS,
  DEFAULT_DINING,
  DEFAULT_TAXONOMIES,
  DEFAULT_CUISINE_IMAGES,
  DEFAULT_TRENDING_COLLAGE,
  LEGACY_SETTINGS,
  LEGACY_PAGES,
  ONBOARDING_CUISINES,
  ONBOARDING_DIETARY,
  ONBOARDING_ALIASES,
  DEFAULT_CITIES,
  DEFAULT_FAQS,
  DEFAULT_WEB_FAQS,
  DEFAULT_PAGES,
  DEFAULT_ONBOARDING,
  DEFAULT_SETTINGS,
};
