import { User, Restaurant, Review, Report, FavoriteList, Notification } from "#models";
import { SENTIMENT_SCORE } from "#models/review.model.js";
import { HashService } from "./HashService.js";

/**
 * SeedService — the single source of truth for demo data.
 * Used by both the CLI (`npm run seed`) and the admin panel Seed/Clear buttons.
 * Assumes an active Mongo connection (does NOT connect/disconnect).
 */

const img = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1080&q=70`;

const FOOD = [
  img("1517248135467-4c7edcad34c4"),
  img("1414235077428-338989a2e8c0"),
  img("1552566626-52f8b828add9"),
  img("1555396273-367ea4eb4db5"),
  img("1600891964092-4316c288032e"),
  img("1533777324565-a040eb52facd"),
];
const DISH = [
  img("1585032226651-759b368d7246"),
  img("1563379926898-05f4575a45d8"),
  img("1546069901-ba9599a7e63c"),
];

const AVG_BY_LEVEL = { $: 12, $$: 30, $$$: 65, $$$$: 110 };

const RESTAURANTS = [
  { name: "White City Restaurant", description: "A refined dining destination in the heart of Baku offering an international menu, warm service and a cozy atmosphere ideal for families and groups.", cuisines: ["International", "Mediterranean"], priceLevel: "$$$", tags: ["Local dishes", "Trendy", "Seating"], features: ["Accepts Credit Cards", "Seating", "Reservations", "Takeout"], address: "Khagani Rustamov str. 5, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8516, 40.3776] }, coverImages: [FOOD[0], FOOD[3], FOOD[4]], popularDishes: [{ name: "Grilled Sea Bass", price: 24, image: DISH[0] }, { name: "Truffle Pasta", price: 18, image: DISH[1] }, { name: "Beef Tenderloin", price: 27, image: DISH[2] }], rating: 4.8, reviewCount: 1024, openNow: true, discountPercent: 0, viewCount: 5400, saveCount: 2100 },
  { name: "SAHiL Bar & Restaurant", description: "Seaside bar and restaurant with a vibrant menu of local dishes, trendy plates and vegan options right on the boulevard.", cuisines: ["Azerbaijani", "International", "Seafood"], priceLevel: "$$$", tags: ["Local dishes", "Trendy", "Halal", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Outdoor Seating", "Reservations"], address: "Seaside Boulevard, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8486, 40.3629] }, coverImages: [FOOD[2], FOOD[5], FOOD[1]], popularDishes: [{ name: "Lamb Ribs", price: 22, image: DISH[0] }, { name: "Seafood Platter", price: 35, image: DISH[1] }], rating: 4.8, reviewCount: 1667, openNow: true, discountPercent: 0, viewCount: 8100, saveCount: 3400 },
  { name: "Anadolu Restaurant & Catering", description: "Authentic Turkish kitchen serving kebabs, mezes and fresh-baked bread. Generous portions and a family-friendly setting.", cuisines: ["Turkish"], priceLevel: "$$", tags: ["Local dishes", "Halal"], features: ["Accepts Credit Cards", "Seating", "Takeout", "Delivery"], address: "Pushkin Str. 5, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8408, 40.3712] }, coverImages: [FOOD[3], FOOD[4]], popularDishes: [{ name: "Mixed Grill", price: 19, image: DISH[2] }, { name: "Adana Kebab", price: 14, image: DISH[0] }], rating: 4.8, reviewCount: 980, openNow: true, discountPercent: 50, viewCount: 4200, saveCount: 1500 },
  { name: "Caspian Grill", description: "Modern grill house overlooking the Caspian with a focus on premium steaks and seasonal produce.", cuisines: ["Steakhouse", "International"], priceLevel: "$$$$", tags: ["Trendy", "Reservations"], features: ["Accepts Credit Cards", "Seating", "Reservations", "Parking"], address: "Neftchilar Ave. 12, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8623, 40.3701] }, coverImages: [FOOD[5], FOOD[0]], popularDishes: [{ name: "Ribeye Steak", price: 42, image: DISH[1] }, { name: "Grilled Salmon", price: 28, image: DISH[2] }], rating: 4.7, reviewCount: 640, openNow: true, discountPercent: 30, viewCount: 3100, saveCount: 1200 },
  { name: "Caravan Baku", description: "A classic Azerbaijani restaurant celebrating traditional recipes in an elegant caravanserai-inspired interior.", cuisines: ["Azerbaijani"], priceLevel: "$$$", tags: ["Local dishes", "Halal"], features: ["Accepts Credit Cards", "Seating", "Reservations"], address: "Fountain Square, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8388, 40.3699] }, coverImages: [FOOD[1], FOOD[4]], popularDishes: [{ name: "Plov", price: 16, image: DISH[0] }, { name: "Dolma", price: 12, image: DISH[1] }], rating: 4.8, reviewCount: 2900, openNow: true, discountPercent: 0, viewCount: 9200, saveCount: 4100 },
  { name: "Firuze Restaurant", description: "Beloved local spot for hearty Azerbaijani classics, fresh salads and homemade desserts.", cuisines: ["Azerbaijani", "Cafe"], priceLevel: "$$", tags: ["Local dishes", "Halal"], features: ["Accepts Credit Cards", "Seating", "Takeout"], address: "Nizami Str. 88, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8451, 40.3745] }, coverImages: [FOOD[4], FOOD[2]], popularDishes: [{ name: "Kutab", price: 8, image: DISH[2] }, { name: "Lamb Stew", price: 15, image: DISH[0] }], rating: 4.5, reviewCount: 8100, openNow: true, discountPercent: 0, viewCount: 6700, saveCount: 2800 },
  { name: "Dolma Restaurant", description: "Traditional dolma house where every dish is prepared with seasonal, locally-sourced ingredients.", cuisines: ["Azerbaijani", "Turkish"], priceLevel: "$$", tags: ["Local dishes", "Halal", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Delivery"], address: "28 May Str. 3, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8477, 40.3792] }, coverImages: [FOOD[0], FOOD[5]], popularDishes: [{ name: "Yarpaq Dolma", price: 13, image: DISH[1] }, { name: "Badimjan Dolma", price: 13, image: DISH[2] }], rating: 4.5, reviewCount: 5200, openNow: false, discountPercent: 20, viewCount: 5900, saveCount: 2400 },
  { name: "China Town Restaurant", description: "Nestled in a vibrant corner of the city, China Town Restaurant offers a cozy and inviting atmosphere that makes it an ideal spot for families and groups alike. Their menu blends classic Chinese favourites with modern twists.", cuisines: ["Chinese"], priceLevel: "$$", tags: ["Trendy", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Reservations", "Takeout"], address: "204 Dilara Aliyeva, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8501, 40.3808] }, coverImages: [FOOD[2], FOOD[3], FOOD[1]], popularDishes: [{ name: "Chicken Noodles", price: 14, image: DISH[0] }, { name: "Shrimp Tempura", price: 16, image: DISH[1] }, { name: "Filet in Black Bean", price: 27, image: DISH[2] }], rating: 3.8, reviewCount: 128, openNow: true, discountPercent: 0, viewCount: 2200, saveCount: 700 },
  { name: "Mama Meri", description: "Warm Georgian kitchen famous for khinkali, khachapuri and a lively, welcoming vibe.", cuisines: ["Georgian"], priceLevel: "$$", tags: ["Local dishes", "Trendy"], features: ["Accepts Credit Cards", "Seating", "Outdoor Seating"], address: "Heydar Aliyev Ave. 45, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8689, 40.4012] }, coverImages: [FOOD[5], FOOD[4]], popularDishes: [{ name: "Adjaruli Khachapuri", price: 11, image: DISH[1] }, { name: "Khinkali (5 pcs)", price: 9, image: DISH[2] }], rating: 4.6, reviewCount: 1420, openNow: true, discountPercent: 40, viewCount: 4800, saveCount: 1900 },
  { name: "Nero Bistro", description: "Contemporary Italian bistro serving wood-fired pizza, handmade pasta and a curated wine list.", cuisines: ["Italian"], priceLevel: "$$$", tags: ["Trendy", "Vegan options"], features: ["Accepts Credit Cards", "Seating", "Reservations", "Wifi"], address: "Rasul Rza Str. 21, Baku", city: "Baku", location: { type: "Point", coordinates: [49.8434, 40.3768] }, coverImages: [FOOD[1], FOOD[0]], popularDishes: [{ name: "Margherita Pizza", price: 13, image: DISH[0] }, { name: "Tagliatelle Ragu", price: 17, image: DISH[1] }], rating: 4.4, reviewCount: 720, openNow: true, discountPercent: 25, viewCount: 3600, saveCount: 1400 },
];

const SEED_USERS = [
  { firstName: "Lala", lastName: "Aliyeva", email: "lala@yumio.app", status: "active", verified: true },
  { firstName: "Ali", lastName: "Mammadov", email: "ali.m@yumio.app", status: "active", verified: true },
  { firstName: "Nigar", lastName: "Huseynova", email: "nigar@yumio.app", status: "active", verified: false },
  { firstName: "Rashad", lastName: "Guliyev", email: "rashad@yumio.app", status: "active", verified: true },
  { firstName: "Aysel", lastName: "Karimova", email: "aysel@yumio.app", status: "active", verified: false },
  { firstName: "Jane", lastName: "Doe", email: "jane@yumio.app", status: "active", verified: true },
  { firstName: "John", lastName: "Smith", email: "john@yumio.app", status: "active", verified: false },
  { firstName: "Elvin", lastName: "Aliyev", email: "elvin@yumio.app", status: "suspended", verified: false },
  { firstName: "Sabina", lastName: "Mammadli", email: "sabina@yumio.app", status: "active", verified: true },
  { firstName: "Tural", lastName: "Ismayilov", email: "tural@yumio.app", status: "pending", verified: false },
  { firstName: "Leyla", lastName: "Abbasova", email: "leyla@yumio.app", status: "active", verified: false },
  { firstName: "Kamran", lastName: "Rzayev", email: "kamran@yumio.app", status: "active", verified: true },
];

const COMMENTS = {
  liked: ["Absolutely amazing food and great atmosphere!", "One of the best spots in Baku. Highly recommend.", "Loved everything — service was top notch.", "Perfect for a date night. Will come again.", "Delicious dishes and cozy interior."],
  fine: ["Decent food, nothing special but okay.", "It was fine — a bit slow on service.", "Average experience overall.", "Good but a little overpriced."],
  disliked: ["Not what I expected, quite disappointing.", "Service was slow and food was cold.", "Wouldn't come back, unfortunately."],
};

const LIST_NAMES = ["The best sushi places in Baku", "Weekend brunch spots", "Date night favourites", "Hidden gems", "Best for groups"];

const REPORTS = [
  { targetType: "review", reason: "Spam / advertising", description: "Review contains promotional links." },
  { targetType: "review", reason: "Offensive language", description: "Inappropriate wording in the comment." },
  { targetType: "restaurant", reason: "Incorrect information", description: "Address and hours are wrong." },
  { targetType: "restaurant", reason: "Closed permanently", description: "This place has shut down." },
  { targetType: "user", reason: "Fake account", description: "Suspected bot posting many reviews." },
  { targetType: "review", reason: "Not a real visit", description: "Reviewer never visited this place." },
];

const pick = (arr, i) => arr[i % arr.length];

class SeedService {
  /** Remove all seed data (keeps admin accounts). Returns deleted counts. */
  static async clearAll() {
    const [restaurants, reviews, reports, lists, users] = await Promise.all([
      Restaurant.deleteMany({}),
      Review.deleteMany({}),
      Report.deleteMany({}),
      FavoriteList.deleteMany({}),
      User.deleteMany({ email: { $in: SEED_USERS.map((u) => u.email) } }),
      Notification.deleteMany({}),
    ]);
    // Clear follow edges left on admin accounts.
    await User.updateMany({ role: "admin" }, { $set: { following: [] } });
    return {
      restaurants: restaurants.deletedCount,
      reviews: reviews.deletedCount,
      reports: reports.deletedCount,
      lists: lists.deletedCount,
      users: users.deletedCount,
    };
  }

  /** Seed everything fresh. Returns created counts. */
  static async seedAll() {
    await this.clearAll();

    // Restaurants
    const restaurants = [];
    for (const r of RESTAURANTS) {
      restaurants.push(await Restaurant.create({ avgPrice: AVG_BY_LEVEL[r.priceLevel] ?? 30, ...r }));
    }

    // Users
    const password = await HashService.hashPassword("Password123!");
    const users = [];
    for (const u of SEED_USERS) {
      users.push(
        await User.create({
          ...u,
          password,
          role: "user",
          preferences: { cuisines: ["Pizza", "Sushi", "Italian"].slice(0, (users.length % 3) + 1), dietary: ["Halal"] },
        }),
      );
    }

    // Reviews
    const sentiments = ["liked", "liked", "liked", "fine", "disliked"];
    let reviews = 0;
    for (let ui = 0; ui < users.length; ui += 1) {
      for (let k = 0; k < 3; k += 1) {
        const restaurant = restaurants[(ui + k) % restaurants.length];
        const sentiment = pick(sentiments, ui + k);
        await Review.create({
          restaurant: restaurant._id,
          user: users[ui]._id,
          sentiment,
          score: SENTIMENT_SCORE[sentiment],
          comment: pick(COMMENTS[sentiment], ui + k),
        });
        reviews += 1;
      }
    }

    // Favorite lists (public/collaborative with items → feed list posts)
    let lists = 0;
    for (let ui = 0; ui < 6; ui += 1) {
      const items = [];
      for (let k = 0; k < 4; k += 1) items.push({ restaurant: restaurants[(ui + k) % restaurants.length]._id });
      await FavoriteList.create({
        name: pick(LIST_NAMES, ui),
        owner: users[ui]._id,
        privacy: ui % 2 === 0 ? "public" : "collaborative",
        items,
      });
      lists += 1;
    }

    // Follows (each user follows next 5 cyclic) + follow notifications
    let followEdges = 0;
    const notifications = [];
    for (let ui = 0; ui < users.length; ui += 1) {
      const following = [];
      for (let k = 1; k <= 5; k += 1) {
        const target = users[(ui + k) % users.length];
        following.push(target._id);
        notifications.push({
          recipient: target._id,
          actor: users[ui]._id,
          type: "follow",
          message: "started following you",
        });
      }
      await User.updateOne({ _id: users[ui]._id }, { $set: { following } });
      followEdges += following.length;
    }
    await Notification.insertMany(notifications);
    const admin = await User.findOne({ role: "admin" });
    if (admin) {
      await User.updateOne({ _id: admin._id }, { $set: { following: users.slice(0, 6).map((u) => u._id) } });
    }

    // Reports
    const someReviews = await Review.find().limit(3);
    let reports = 0; for (let i = 0; i < REPORTS.length; i += 1) {
      const r = REPORTS[i];
      let targetId;
      let targetLabel;
      if (r.targetType === "review") {
        targetId = someReviews[i % someReviews.length]._id;
        targetLabel = "Review by user";
      } else if (r.targetType === "restaurant") {
        const rest = restaurants[i % restaurants.length];
        targetId = rest._id;
        targetLabel = rest.name;
      } else {
        const u = users[i % users.length];
        targetId = u._id;
        targetLabel = `${u.firstName} ${u.lastName}`;
      }
      await Report.create({ ...r, targetId, targetLabel, reporter: users[(i + 1) % users.length]._id, status: i < 5 ? "open" : "resolved" });
      reports += 1;
    }

    return {
      restaurants: restaurants.length,
      users: users.length,
      reviews,
      lists,
      followEdges,
      reports,
    };
  }
}

export { SeedService };
