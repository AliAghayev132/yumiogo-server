// User roles
const userRoles = ["user", "admin"];

// Account status
const accountStatus = ["active", "suspended", "pending"];

// Post status (kept from the template's example resource)
const postStatus = ["draft", "published", "archived"];

// OTP types
const otpTypes = ["register", "reset-password", "verify-email"];

// ----- Yumio domain enums -----

// Restaurant lifecycle status
const restaurantStatus = ["active", "pending", "closed"];

// Price level (shown as $ symbols in the UI)
const priceRange = ["$", "$$", "$$$", "$$$$"];

// Supported cuisine categories (Home "Cuisines" row + filters)
const cuisineTypes = [
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
];

// Amenity/feature tags rendered on the restaurant profile
const restaurantFeatures = [
  "Accepts Credit Cards",
  "Seating",
  "Reservations",
  "Takeout",
  "Delivery",
  "Parking",
  "Wifi",
  "Outdoor Seating",
];

// Review reaction (the emoji reactions in the Figma "How was your experience?")
const reviewReactions = ["liked", "fine", "disliked"];

// Report (admin moderation queue)
const reportTargetTypes = ["review", "restaurant", "user"];
const reportStatuses = ["open", "resolved", "dismissed"];

// Favorite list privacy
const favoritePrivacy = ["public", "collaborative", "private"];

// Notification types
const notificationTypes = ["follow", "review", "list", "system"];

export {
  userRoles,
  accountStatus,
  postStatus,
  otpTypes,
  restaurantStatus,
  priceRange,
  cuisineTypes,
  restaurantFeatures,
  reviewReactions,
  reportTargetTypes,
  reportStatuses,
  favoritePrivacy,
  notificationTypes,
};
