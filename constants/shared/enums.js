// User roles
const userRoles = ["user", "admin"];

// Account status. "pending" = awaiting admin approval (Settings.newUserApproval),
// "suspended" = temporary (optional suspendedUntil), "banned" = until restored.
const accountStatus = ["active", "suspended", "pending", "banned"];

// OTP types
const otpTypes = ["register", "reset-password", "verify-email"];

// ----- Yumio domain enums -----

// Restaurant lifecycle status. Only "active" is public. "pending" awaits admin
// approval, "rejected"/"suspended" are moderation outcomes, "closed" = the
// business closed.
const restaurantStatus = ["active", "pending", "suspended", "rejected", "closed"];

// Platform languages (Settings.defaultLanguage) with their display names.
const APP_LANGUAGES = ["en", "az", "ru"];
const APP_LANGUAGE_LABELS = { en: "English", az: "Azərbaycanca", ru: "Русский" };

// Price level (shown as $ symbols in the UI)
const priceRange = ["$", "$$", "$$$", "$$$$"];

// ----- Admin-managed catalog -----
// The actual cuisines/features/tags/... live in the Taxonomy collection (admin
// Catalog pages). Their first-boot defaults are in ./catalogDefaults.js.

// Taxonomy item types.
// "dining" = dining options (Breakfast, Lunch, Brunch…) on Restaurant.dining.
const TAXONOMY_TYPES = [
  "cuisine",
  "feature",
  "tag",
  "dietary",
  "mood",
  "reportReason",
  "reviewLabel",
  "dining",
];

// Taxonomy type → Restaurant array field that stores the item names.
// reportReason has none (it is stored on Report.reason).
const TAXONOMY_FIELD = {
  cuisine: "cuisines",
  feature: "features",
  tag: "tags",
  dietary: "dietary",
  mood: "moods",
  dining: "dining",
  reportReason: null,
  // Stored on Review.labels.
  reviewLabel: null,
};

// Taxonomy type → User field cascaded on rename / delete.
const TAXONOMY_PREFERENCE_FIELD = {
  cuisine: "preferences.cuisines",
  dietary: "preferences.dietary",
};

// Search result sort keys the API understands (?sort=). "rating" = Average
// rating, "newest" = New restaurants, "price_asc" = Price; the *_month /
// on_the_rise keys rank by the rolling Restaurant.stats windows.
const SORT_KEYS = [
  "distance",
  "rating",
  "popularity",
  "saved",
  "newest",
  "price_asc",
  "price_desc",
  "relevance",
  "top_rated_month",
  "trending_month",
  "most_saved_month",
  "on_the_rise",
];

// "Trending this month" sheet options (Settings.trendingOptions keys) — each
// is also a sort key.
const TRENDING_KEYS = ["most_saved_month", "top_rated_month", "on_the_rise"];

// Recommendation collections — Home "Recommends" and Search "Popular also
// search for" tiles (Settings.recommendations keys).
const RECOMMENDATION_KEYS = ["trending", "bestRated", "friendPicks"];

// Home feed sections (Settings.homeSections keys), in the Figma default order.
const HOME_SECTION_KEYS = [
  "cuisines",
  "nearYou",
  "discounted",
  "recentlyViewed",
  "recommends",
  "topWeek",
  "surprise",
];

// Search history / suggestion entry types.
const SEARCH_ENTRY_TYPES = ["query", "restaurant", "cuisine", "mood", "dish", "place"];

// Per-user notification toggles (User.settings keys, Settings.notificationOptions),
// in the Figma Settings order: the e-mail switch, then the push switches
// (reservations, new follower alerts) and the push master switch last.
const NOTIFICATION_OPTION_KEYS = [
  "emailNotifications",
  "reservationAlerts",
  "followerAlerts",
  "pushNotifications",
];

// Restaurant.hours keys.
const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Which client an FAQ entry is shown in.
const faqAudiences = ["app", "web", "both"];

// Review reaction (the emoji reactions in the Figma "How was your experience?")
const reviewReactions = ["liked", "fine", "disliked"];

// Review moderation status (only "approved" reviews are public and rated).
const reviewStatuses = ["pending", "approved", "flagged", "rejected"];

// Label idea sent from the review "Request a label" dialog.
const labelRequestStatuses = ["pending", "approved", "rejected"];

// Report (admin moderation queue)
const reportTargetTypes = ["review", "restaurant", "user", "list"];
const reportStatuses = ["open", "in_review", "resolved", "dismissed"];
// Optional enforcement applied when an admin resolves a review report.
const reportActions = ["none", "hide_review", "delete_review", "remove_list"];

// Favorite list privacy
const favoritePrivacy = ["public", "collaborative", "private"];

// Notification types (see models/notification.model.js for what each means).
// "review" / "list" are legacy values kept readable.
const notificationTypes = [
  "follow",
  "follow_suggestion",
  "list_save",
  "list_visit",
  "review_like",
  "comment",
  "reply",
  "mention",
  "share",
  "collaborator_invite",
  "system",
  "review",
  "list",
  // A followed restaurant started a discount / added dishes (RestaurantFollowService).
  "restaurant_offer",
  "restaurant_menu",
];

export {
  APP_LANGUAGES,
  APP_LANGUAGE_LABELS,
  userRoles,
  accountStatus,
  otpTypes,
  restaurantStatus,
  priceRange,
  TAXONOMY_TYPES,
  TAXONOMY_FIELD,
  TAXONOMY_PREFERENCE_FIELD,
  SORT_KEYS,
  TRENDING_KEYS,
  RECOMMENDATION_KEYS,
  HOME_SECTION_KEYS,
  SEARCH_ENTRY_TYPES,
  NOTIFICATION_OPTION_KEYS,
  WEEK_DAYS,
  faqAudiences,
  reviewReactions,
  reviewStatuses,
  labelRequestStatuses,
  reportTargetTypes,
  reportStatuses,
  reportActions,
  favoritePrivacy,
  notificationTypes,
};
