import { crypto } from "#lib";
import {
  User,
  Restaurant,
  Review,
  Report,
  FavoriteList,
  Notification,
  Taxonomy,
  City,
  ContentPage,
  MenuCategory,
  MenuItem,
  Comment,
  ReviewLabelRequest,
  RestaurantView,
  SearchHistory,
  RestaurantFollow,
} from "#models";
import { SENTIMENT_SCORE } from "#models/review.model.js";
import { httpError } from "#utils";
import { foldText } from "#utils/search.js";
import { derivePriceLevel } from "#utils/pricing.js";
import { HashService } from "./HashService.js";
import { CatalogService } from "./CatalogService.js";
import { PlatformService } from "./PlatformService.js";
import { ReviewService } from "./ReviewService.js";
import { RestaurantStatsService } from "./RestaurantStatsService.js";
import { MenuService } from "./MenuService.js";
import * as DEMO from "./seed/demoData.js";

/**
 * SeedService — the single source of truth for demo data ("Load mock data").
 * Used by both the CLI (`npm run seed`) and the admin panel Data card.
 * Assumes an active Mongo connection (does NOT connect/disconnect).
 *
 * seedAll() replaces the previous demo batch with a fresh, consistent one that
 * exercises every feature: restaurants in several cities (hours incl.
 * late-night / closed days, price ranges, discounts, photos, pending /
 * suspended / rejected / temporarily closed / Trash), menus with categories,
 * dish photos and menu photos, people (avatars, bios, preferences, privacy,
 * invites, moderation states), a follow graph, favourite lists (Saved +
 * public / private / collaborative, collaborators, list saves), reviews with
 * labels / companions / favourite dishes / photos / moderation statuses,
 * likes, threaded comments with mentions, shares, notifications of every type,
 * reports, label requests, restaurant follows, 90 days of profile views,
 * recently viewed and search history.
 *
 * Safety rules:
 *  - only available when PlatformService.isDemoDataEnabled() (not production,
 *    unless ENABLE_DEMO_SEED=true);
 *  - every document it creates carries `isSeed: true` from the moment it is
 *    written (outside the schemas), and clearAll() deletes ONLY those — real
 *    data is never touched, references from real data to demo documents are
 *    cleaned up;
 *  - demo accounts get the known password "Password123!" only in
 *    development; elsewhere a random one nobody knows;
 *  - every aggregate is DERIVED from the seeded records: ratings / review
 *    counts (ReviewService), saveCount (list owners), viewCount (view rows),
 *    followerCount (follow rows), like / comment / reply / share counters and
 *    the rolling stats (RestaurantStatsService) — no made-up numbers;
 *  - catalog values come from the admin catalog (unknown names are dropped),
 *    and the demo images live in folders that are never swept or wiped
 *    (uploads/restaurants/seed, uploads/catalog/defaults).
 * The batch is deterministic (seeded PRNG), relative to "now".
 */

// Development-only password of the demo accounts.
const DEMO_PASSWORD = "Password123!";
const SEED = { isSeed: true };
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PRNG_SEED = 20260929;
const VIEW_CHUNK = 1000;

// Notification types controlled by settings.followerAlerts.
const FOLLOWER_TYPES = new Set(["follow", "follow_suggestion"]);

const norm = (value) => String(value ?? "").trim().toLowerCase();
const idStr = (value) => (value ? String(value._id ?? value) : "");
const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
const maxDate = (...dates) => new Date(Math.max(...dates.filter(Boolean).map((d) => new Date(d).getTime())));
const unique = (values) => [...new Set(values)];

// A demo document: tagged isSeed at insert time (strict:false keeps the extra field).
const seedDoc = (Model, data) => new Model({ ...data, ...SEED }, null, { strict: false });
const createSeed = (Model, data) => seedDoc(Model, data).save();
const insertSeed = async (Model, rows) => (rows.length ? Model.insertMany(rows.map((r) => seedDoc(Model, r))) : []);

// Driver-level helpers (isSeed is not in the schemas).
const seedIds = (Model) => Model.collection.distinct("_id", SEED);
const countSeed = (Model) => Model.collection.countDocuments(SEED);
const dropSeed = async (Model) => (await Model.collection.deleteMany(SEED)).deletedCount;

// Mulberry32 — deterministic pseudo-random numbers in [0, 1).
const prng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Price level from the average price when the admin bands are off.
const fallbackPriceLevel = (avg) => (avg < 15 ? "$" : avg < 35 ? "$$" : avg < 70 ? "$$$" : "$$$$");

/** Restaurant.saveCount = distinct owners having the restaurant in one of their lists. */
const recomputeSaveCounts = async (restaurantIds) => {
  if (!restaurantIds.length) return;
  const saves = await FavoriteList.aggregate([
    { $match: { isDeleted: false, "items.restaurant": { $in: restaurantIds } } },
    { $unwind: "$items" },
    { $match: { "items.restaurant": { $in: restaurantIds } } },
    { $group: { _id: "$items.restaurant", owners: { $addToSet: "$owner" } } },
  ]);
  const byId = new Map(saves.map((s) => [String(s._id), s.owners.length]));
  await Restaurant.bulkWrite(
    restaurantIds.map((id) => ({
      updateOne: { filter: { _id: id }, update: { $set: { saveCount: byId.get(String(id)) || 0 } } },
    })),
    { timestamps: false },
  );
};

/** Restaurant.viewCount = de-duplicated view rows; followerCount = follow rows. */
const recomputeViewAndFollowerCounts = async (restaurantIds) => {
  if (!restaurantIds.length) return;
  const [views, follows] = await Promise.all([
    RestaurantView.aggregate([
      { $match: { restaurant: { $in: restaurantIds } } },
      { $group: { _id: "$restaurant", count: { $sum: 1 } } },
    ]),
    RestaurantFollow.aggregate([
      { $match: { restaurant: { $in: restaurantIds } } },
      { $group: { _id: "$restaurant", count: { $sum: 1 } } },
    ]),
  ]);
  const viewsById = new Map(views.map((v) => [String(v._id), v.count]));
  const followsById = new Map(follows.map((f) => [String(f._id), f.count]));
  await Restaurant.bulkWrite(
    restaurantIds.map((id) => ({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: { viewCount: viewsById.get(String(id)) || 0, followerCount: followsById.get(String(id)) || 0 },
        },
      },
    })),
    { timestamps: false },
  );
};

/** Review.commentCount (live comments incl. replies) + Comment.replyCount of the given reviews. */
const recomputeCommentCounts = async (reviewIds) => {
  if (!reviewIds.length) return;
  const [perReview, perParent] = await Promise.all([
    Comment.aggregate([
      { $match: { review: { $in: reviewIds }, isDeleted: false } },
      { $group: { _id: "$review", count: { $sum: 1 } } },
    ]),
    Comment.aggregate([
      { $match: { review: { $in: reviewIds }, isDeleted: false, parent: { $ne: null } } },
      { $group: { _id: "$parent", count: { $sum: 1 } } },
    ]),
  ]);
  const byReview = new Map(perReview.map((r) => [String(r._id), r.count]));
  await Review.bulkWrite(
    reviewIds.map((id) => ({
      updateOne: { filter: { _id: id }, update: { $set: { commentCount: byReview.get(String(id)) || 0 } } },
    })),
    { timestamps: false },
  );
  const parents = await Comment.find({ review: { $in: reviewIds }, parent: null }, "_id").lean();
  const byParent = new Map(perParent.map((p) => [String(p._id), p.count]));
  if (parents.length) {
    await Comment.bulkWrite(
      parents.map((p) => ({
        updateOne: { filter: { _id: p._id }, update: { $set: { replyCount: byParent.get(String(p._id)) || 0 } } },
      })),
      { timestamps: false },
    );
  }
};

// =====================================================================
// DemoSeeder — one "Load mock data" run
// =====================================================================

class DemoSeeder {
  constructor() {
    this.now = new Date();
    this.random = prng(PRNG_SEED);
    this.restaurants = new Map(); // key → { key, doc, def, createdAt, live, items }
    this.restaurantsById = new Map();
    this.users = new Map(); // key → { key, doc, def, createdAt, status, following:Set<key> }
    this.usersById = new Map();
    this.lists = []; // { doc, owner, custom, followersAt: Map<userKey, Date> }
    this.reviews = []; // { doc, author, restaurant }
    this.comments = [];
    this.follows = []; // { from, to, at }
    this.restaurantFollows = []; // { user, restaurant, at }
    this.notes = [];
    this.viewedBy = new Map(); // userKey → Set<restaurantKey>
    this.counts = {};
  }

  // ------------------------------------------------------------ random

  r() {
    return this.random();
  }

  int(min, max) {
    return min + Math.floor(this.r() * (max - min + 1));
  }

  chance(p) {
    return this.r() < p;
  }

  pick(list) {
    return list.length ? list[Math.floor(this.r() * list.length)] : undefined;
  }

  /** `n` distinct entries; `weight(entry)` biases the draw. */
  sample(list, n, weight = () => 1) {
    const pool = list.map((entry) => ({ entry, w: Math.max(0, weight(entry)) })).filter((x) => x.w > 0);
    const out = [];
    while (out.length < n && pool.length) {
      const total = pool.reduce((s, x) => s + x.w, 0);
      let roll = this.r() * total;
      const index = pool.findIndex((x) => (roll -= x.w) < 0);
      const [chosen] = pool.splice(index < 0 ? pool.length - 1 : index, 1);
      out.push(chosen.entry);
    }
    return out;
  }

  // ------------------------------------------------------------ time

  ago(days, hours = 0) {
    return new Date(this.now.getTime() - days * DAY - hours * HOUR);
  }

  /** A moment between `from` and `to` (default now); skew > 1 leans towards `to`. */
  between(from, to = this.now, skew = 1) {
    const start = new Date(from).getTime();
    const end = Math.min(new Date(to).getTime(), this.now.getTime() - 5 * MIN);
    if (end <= start) return new Date(Math.min(start, this.now.getTime() - 5 * MIN));
    const t = skew === 1 ? this.r() : 1 - Math.pow(this.r(), skew);
    return new Date(start + (end - start) * t);
  }

  // ------------------------------------------------------------ catalog

  async loadContext() {
    const [taxonomies, cities, defaultCity, admins, settings, privacy] = await Promise.all([
      Taxonomy.find({ isActive: true }, "type name group").lean(),
      City.find({ isActive: true }, "name").lean(),
      City.getDefault(),
      User.find({ role: "admin", isDeleted: false }, "firstName lastName status").sort({ createdAt: 1 }).lean(),
      CatalogService.getSettings(),
      ContentPage.findOne({ slug: "privacy" }, "updatedAt").lean(),
    ]);
    this.catalog = {};
    taxonomies.forEach((t) => {
      if (!this.catalog[t.type]) this.catalog[t.type] = new Map();
      this.catalog[t.type].set(norm(t.name), t);
    });
    this.cities = new Map(cities.map((c) => [norm(c.name), c]));
    this.defaultCity = defaultCity?.name || cities[0]?.name || "Baku";
    this.admins = admins.filter((a) => a.status === "active");
    this.admin = this.admins[0] || admins[0] || null;
    this.priceLevels = CatalogService.priceLevels(settings);
    const labels = [...(this.catalog.reviewLabel?.values() || [])];
    const isBad = (label) => /wrong/i.test(label.group || "");
    this.labels = {
      good: labels.filter((l) => !isBad(l)).map((l) => l.name),
      bad: labels.filter(isBad).map((l) => l.name),
    };
    this.reasons = [...(this.catalog.reportReason?.values() || [])].map((r) => r.name);
    this.termsVersion = privacy?.updatedAt ? new Date(privacy.updatedAt).toISOString() : "1";
    this.password = await HashService.hashPassword(
      PlatformService.isDevelopment() ? DEMO_PASSWORD : crypto.randomBytes(24).toString("base64url"),
    );
  }

  /** Canonical catalog names of `values` (unknown / inactive ones dropped). */
  names(type, values = []) {
    const map = this.catalog[type];
    if (!map) return [];
    return unique(values.map((v) => map.get(norm(v))?.name).filter(Boolean));
  }

  reason(name) {
    return this.reasons.find((r) => norm(r) === norm(name)) || this.reasons[0] || name;
  }

  // ------------------------------------------------------------ lookups

  user(key) {
    return this.users.get(key);
  }

  activeUsers() {
    return [...this.users.values()].filter((u) => u.status === "active");
  }

  liveRestaurants() {
    return [...this.restaurants.values()].filter((r) => r.live);
  }

  followersOf(entry) {
    return [...this.users.values()].filter((u) => u.following?.has(entry.key));
  }

  connected(a, b) {
    return a.following?.has(b.key) || b.following?.has(a.key);
  }

  // ------------------------------------------------------------ notifications

  /**
   * Queue a notification (inserted in one batch at the end). Mirrors
   * Notification.notify: no self-notifications, only active recipients, the
   * follower-alerts switch, the same dedupeKey. Older ones are mostly read.
   */
  note({ recipient, actor = null, type, at, restaurant = null, list = null, review = null, comment = null, title = "", message = "", data = {} }) {
    const to = this.usersById.get(idStr(recipient));
    const isAdmin = this.admins.some((a) => idStr(a) === idStr(recipient));
    if (!recipient || (!isAdmin && (!to || to.status !== "active"))) return;
    if (actor && idStr(actor) === idStr(recipient)) return;
    if (FOLLOWER_TYPES.has(type) && to?.def.settings?.followerAlerts === false) return;
    const createdAt = new Date(Math.min(new Date(at).getTime(), this.now.getTime() - MIN));
    const read = createdAt < this.ago(3) ? this.chance(0.9) : this.chance(0.35);
    const readAt = read ? this.between(createdAt, new Date(createdAt.getTime() + 12 * HOUR)) : null;
    this.notes.push({
      recipient: idStr(recipient),
      actor: actor ? idStr(actor) : null,
      type,
      restaurant: restaurant ? idStr(restaurant) : null,
      list: list ? idStr(list) : null,
      review: review ? idStr(review) : null,
      comment: comment ? idStr(comment) : null,
      title,
      message,
      data,
      dedupeKey: [type, idStr(actor), idStr(restaurant), idStr(list), idStr(review), idStr(comment)].join(":"),
      read,
      readAt,
      createdAt,
      updatedAt: readAt || createdAt,
    });
  }

  // ------------------------------------------------------------ restaurants + menus

  async seedRestaurants() {
    const adminId = this.admin?._id || null;
    for (const def of DEMO.RESTAURANTS) {
      const city = this.cities.get(norm(def.city));
      if (!city) continue; // the admin removed / disabled this city
      const createdAt = this.ago(def.age, this.int(1, 10));
      const [avgPrice, priceMin, priceMax] = def.price;
      const status = def.status || "active";
      const moderatedAt = {
        suspended: this.ago(10, 3),
        rejected: new Date(createdAt.getTime() + 20 * HOUR),
        closed: this.ago(29, 2),
      }[status] || null;
      const everLive = !["pending", "rejected"].includes(status);
      const doc = await createSeed(Restaurant, {
        name: def.name,
        description: def.description,
        cuisines: this.names("cuisine", def.cuisines),
        features: this.names("feature", def.features),
        tags: this.names("tag", def.tags),
        dietary: this.names("dietary", def.dietary),
        moods: this.names("mood", def.moods),
        dining: this.names("dining", def.dining),
        priceLevel: derivePriceLevel(avgPrice, this.priceLevels) || fallbackPriceLevel(avgPrice),
        avgPrice,
        priceMin,
        priceMax,
        address: `${def.address}, ${def.hood}`,
        city: city.name,
        location: { type: "Point", coordinates: def.coords },
        coverImages: def.covers.map(DEMO.cover),
        menuPhotos: def.menuPhotos || [],
        hours: DEMO.HOURS[def.hours],
        temporarilyClosed: !!def.temporarilyClosed,
        phone: def.phone,
        discountPercent: def.discount || 0,
        status,
        statusReason: def.statusReason || "",
        moderatedAt,
        moderatedBy: moderatedAt ? adminId : null,
        publishedAt: everLive ? new Date(createdAt.getTime() + 2 * HOUR) : null,
        isDeleted: !!def.isDeleted,
        createdBy: adminId,
        menuImportedAt: this.now,
        createdAt,
        updatedAt: moderatedAt || createdAt,
      });
      const entry = { key: def.key, doc, def, createdAt, live: status === "active" && !def.isDeleted, items: [] };
      this.restaurants.set(def.key, entry);
      this.restaurantsById.set(String(doc._id), entry);
    }
    this.counts.restaurants = this.restaurants.size;
  }

  async seedMenus() {
    let categories = 0;
    let items = 0;
    for (const entry of this.restaurants.values()) {
      const sections = DEMO.MENUS[entry.def.menu] || [];
      const at = entry.createdAt;
      const cats = sections.map(([name], order) =>
        seedDoc(MenuCategory, { restaurant: entry.doc._id, name, order, createdAt: at, updatedAt: at }),
      );
      // Some kitchens have one dish off the menu today ("unavailable").
      const hideOne = this.chance(0.35);
      let hidden = false;
      const rows = [];
      sections.forEach(([, dishes], ci) =>
        dishes.forEach(([name, price, description, dietary, popular, image], order) => {
          const unavailable = hideOne && !hidden && !popular && ci === sections.length - 1;
          if (unavailable) hidden = true;
          rows.push(
            seedDoc(MenuItem, {
              restaurant: entry.doc._id,
              category: cats[ci]._id,
              name,
              price,
              description,
              dietary: this.names("dietary", dietary),
              isPopular: !!popular,
              isAvailable: !unavailable,
              image: image || null,
              order,
              searchKey: foldText(name),
              createdAt: at,
              updatedAt: at,
            }),
          );
        }),
      );
      if (cats.length) await MenuCategory.insertMany(cats);
      if (rows.length) await MenuItem.insertMany(rows);
      entry.items = rows;
      categories += cats.length;
      items += rows.length;
      // Derived popularDishes + menuItemCount.
      await MenuService.syncRestaurant(entry.doc._id);
    }
    this.counts.menuCategories = categories;
    this.counts.menuItems = items;
  }

  // ------------------------------------------------------------ people

  async seedUsers() {
    const adminId = this.admin?._id || null;
    for (const def of DEMO.USERS) {
      if (await User.exists({ email: def.email })) {
        console.warn(`Seed: ${def.email} already exists and is not demo data — skipped`);
        continue;
      }
      const createdAt = this.ago(def.age, this.int(1, 20));
      const status = def.status || "active";
      const changedAt = status === "active" || status === "pending" ? null : this.ago(Math.min(def.age - 1, 3), 5);
      const codeFree = def.inviteCode && !(await User.exists({ inviteCode: def.inviteCode }));
      const doc = await createSeed(User, {
        firstName: def.firstName,
        lastName: def.lastName,
        email: def.email,
        password: this.password,
        phone: def.phone || null,
        avatar: def.avatar || null,
        city: this.cities.get(norm(def.city))?.name || this.defaultCity,
        isPrivate: !!def.isPrivate,
        language: def.language || "en",
        authProvider: "local",
        terms: { version: this.termsVersion, acceptedAt: createdAt, method: "register" },
        role: "user",
        status,
        verified: !!def.verified,
        bio: def.bio || "",
        preferences: {
          cuisines: this.names("cuisine", def.cuisines),
          dietary: this.names("dietary", def.dietary),
        },
        ...(codeFree ? { inviteCode: def.inviteCode } : {}),
        invitesSent: def.invitesSent || 0,
        settings: { ...(def.settings || {}) },
        statusReason: def.statusReason || "",
        suspendedUntil: def.suspendDays ? new Date(this.now.getTime() + def.suspendDays * DAY) : null,
        statusChangedAt: changedAt,
        statusChangedBy: changedAt ? adminId : null,
        warnings: (def.warnings || []).map((reason, k) => ({ reason, by: adminId, createdAt: this.ago(5 + k * 9) })),
        lastLogin: status === "active" ? this.ago(0, this.int(1, 70)) : changedAt,
        createdAt,
        updatedAt: changedAt || createdAt,
      });
      const entry = { key: def.key, doc, def, createdAt, status, following: new Set() };
      this.users.set(def.key, entry);
      this.usersById.set(String(doc._id), entry);
    }

    // Invites: who joined with whose link (the invitee follows the inviter — see FOLLOWS).
    let invites = 0;
    for (const entry of this.users.values()) {
      const inviter = this.user(entry.def.invitedBy);
      if (!inviter) continue;
      await User.updateOne({ _id: entry.doc._id }, { $set: { invitedBy: inviter.doc._id } }, { timestamps: false });
      invites += 1;
      this.note({
        recipient: inviter.doc._id,
        actor: entry.doc._id,
        type: "follow_suggestion",
        at: new Date(entry.createdAt.getTime() + 10 * MIN),
        data: { reason: "invite" },
      });
    }
    // Someone from Leyla's contacts joined.
    const [nargiz, leyla] = [this.user("nargiz"), this.user("leyla")];
    if (nargiz && leyla) {
      this.note({
        recipient: leyla.doc._id,
        actor: nargiz.doc._id,
        type: "follow_suggestion",
        at: new Date(nargiz.createdAt.getTime() + 30 * MIN),
        data: { reason: "contact" },
      });
    }
    this.counts.users = this.users.size;
    this.counts.invites = invites;
  }

  async seedFollows() {
    for (const [key, targets] of Object.entries(DEMO.FOLLOWS)) {
      const from = this.user(key);
      if (!from) continue;
      const to = targets.map((k) => this.user(k)).filter((t) => t && t !== from);
      await User.updateOne(
        { _id: from.doc._id },
        { $set: { following: to.map((t) => t.doc._id) } },
        { timestamps: false },
      );
      to.forEach((target) => {
        from.following.add(target.key);
        const at = this.between(maxDate(from.createdAt, target.createdAt), this.now, 1.3);
        this.follows.push({ from, to: target, at });
        if (at > this.ago(60)) this.note({ recipient: target.doc._id, actor: from.doc._id, type: "follow", at });
      });
    }
    // Lala hid John from "Suggested people".
    const [lala, john] = [this.user("lala"), this.user("john")];
    if (lala && john) {
      await User.updateOne({ _id: lala.doc._id }, { $set: { dismissedSuggestions: [john.doc._id] } }, { timestamps: false });
    }
    // Admins follow a few demo people so their feed has posts (added, never replacing real follows).
    const featured = ["lala", "ali", "rashad", "jane", "leyla", "kamran"].map((k) => this.user(k)).filter(Boolean);
    if (featured.length) {
      await User.updateMany(
        { role: "admin", isDeleted: false },
        { $addToSet: { following: { $each: featured.map((u) => u.doc._id) } } },
        { timestamps: false },
      );
    }
    this.counts.followEdges = this.follows.length;
  }

  // ------------------------------------------------------------ lists

  async seedLists() {
    const live = this.liveRestaurants();
    const rows = [];

    // Every member's default "Saved" list (the heart button), private.
    for (const u of this.users.values()) {
      if (u.status === "pending") continue;
      const prefs = new Set(u.doc.preferences?.cuisines || []);
      const picks = this.sample(live, this.int(2, 5), (r) =>
        (r.doc.cuisines.some((c) => prefs.has(c)) ? 4 : 1) + (r.doc.city === u.doc.city ? 2 : 0),
      );
      const items = picks
        .map((r) => ({
          restaurant: r.doc._id,
          savedAt: this.between(maxDate(u.createdAt, r.createdAt), this.now, 1.4),
          addedBy: u.doc._id,
        }))
        .sort((a, b) => a.savedAt - b.savedAt);
      rows.push({
        owner: u,
        custom: false,
        data: {
          name: "Saved",
          owner: u.doc._id,
          privacy: "private",
          isDefault: true,
          items,
          createdAt: u.createdAt,
          updatedAt: items.length ? items[items.length - 1].savedAt : u.createdAt,
        },
      });
    }

    // Custom lists: public / private / collaborative, collaborators, saves.
    for (const def of DEMO.LISTS) {
      const owner = this.user(def.owner);
      if (!owner) continue;
      const createdAt = maxDate(this.ago(def.age, this.int(1, 12)), new Date(owner.createdAt.getTime() + HOUR));
      const collaborators = (def.collaborators || [])
        .map(([key, role]) => ({ member: this.user(key), role }))
        .filter(({ member }) => member && member !== owner)
        .map(({ member, role }) => ({
          user: member.doc._id,
          role,
          addedAt: this.between(maxDate(createdAt, member.createdAt), this.now),
          addedBy: owner.doc._id,
          member,
        }));
      const editors = collaborators.filter((c) => c.role === "editor");
      const items = def.items
        .map((key) => this.restaurants.get(key))
        .filter((r) => r?.live)
        .map((r, i) => {
          const editor = def.privacy === "collaborative" && i % 2 === 1 ? this.pick(editors) : null;
          const from = maxDate(createdAt, r.createdAt, editor?.addedAt);
          return {
            restaurant: r.doc._id,
            savedAt: this.between(from, this.now, 1.2),
            addedBy: editor ? editor.user : owner.doc._id,
          };
        })
        .sort((a, b) => a.savedAt - b.savedAt);
      const savers = def.privacy === "private"
        ? []
        : (def.followers || []).map((k) => this.user(k)).filter((u) => u && u !== owner);
      const followersAt = new Map(savers.map((u) => [u.key, this.between(maxDate(createdAt, u.createdAt), this.now, 1.2)]));
      rows.push({
        owner,
        custom: true,
        collaborators,
        followersAt,
        data: {
          name: def.name,
          owner: owner.doc._id,
          privacy: def.privacy,
          isDefault: false,
          collaborators: collaborators.map(({ member: _member, ...c }) => c),
          items,
          followers: savers.map((u) => u.doc._id),
          createdAt,
          updatedAt: maxDate(createdAt, ...items.map((it) => it.savedAt)),
        },
      });
    }

    let listItems = 0;
    for (const row of rows) {
      const doc = await createSeed(FavoriteList, row.data);
      listItems += row.data.items.length;
      this.lists.push({ doc, owner: row.owner, custom: row.custom, followersAt: row.followersAt || new Map() });
      // The owner (or an editor) looked at each place around the time it was saved.
      row.data.items.forEach((it) => {
        const by = this.usersById.get(String(it.addedBy));
        const restaurant = this.restaurantsById.get(String(it.restaurant));
        if (by && restaurant) this.userView(by, restaurant, new Date(it.savedAt.getTime() - 5 * MIN));
      });
      (row.collaborators || []).forEach((c) =>
        this.note({ recipient: c.user, actor: row.owner.doc._id, type: "collaborator_invite", list: doc._id, at: c.addedAt }),
      );
      (row.followersAt || new Map()).forEach((at, key) =>
        this.note({ recipient: row.owner.doc._id, actor: this.user(key).doc._id, type: "list_save", list: doc._id, at }),
      );
    }
    this.counts.lists = this.lists.length;
    this.counts.listItems = listItems;
    this.counts.listSaves = this.lists.reduce((s, l) => s + l.followersAt.size, 0);
  }

  // ------------------------------------------------------------ reviews

  reviewText(sentiment, dishName, city) {
    const pool = DEMO.REVIEW_TEXT[sentiment];
    const first = this.pick(pool);
    const parts = [first];
    if (this.chance(0.5)) parts.push(this.pick(pool.filter((t) => t !== first)));
    return parts.join(" ").replace(/\{dish\}/g, dishName).replace(/\{city\}/g, city).slice(0, 500);
  }

  async seedReviews() {
    const authors = [...this.users.values()].filter((u) => u.status !== "pending");
    const frequent = new Set(["lala", "ali", "rashad", "kamran", "jane", "leyla"]);
    const rows = [];

    for (const entry of this.restaurants.values()) {
      const { def } = entry;
      const suspended = def.status === "suspended";
      if (!entry.live && !suspended) continue;
      const count = suspended ? 2 : Math.min(9, Math.max(2, Math.round(2 + def.hot * 0.55 + this.r() * 2)));
      const cuisines = new Set(entry.doc.cuisines);
      const chosen = this.sample(authors, count, (u) => {
        let w = 1;
        if (u.doc.city === entry.doc.city) w += 2;
        if ((u.doc.preferences?.cuisines || []).some((c) => cuisines.has(c))) w += 2;
        if (frequent.has(u.key)) w += 1.5;
        if (u.status !== "active") w *= 0.35;
        return w;
      });
      const available = entry.items.filter((i) => i.isAvailable);
      const popular = available.filter((i) => i.isPopular);

      for (const author of chosen) {
        const from = new Date(maxDate(entry.createdAt, author.createdAt).getTime() + DAY);
        if (from > this.ago(0, 2)) continue;
        // Recent activity drives "Top this week" / trending; "rising" places peak this week.
        let createdAt;
        const roll = this.r();
        if (def.temporarilyClosed || suspended) createdAt = this.between(from, this.ago(15));
        else if (roll < Math.min(0.4, 0.14 * def.rising)) createdAt = this.between(maxDate(from, this.ago(7)), this.now);
        else if (roll < 0.42) createdAt = this.between(maxDate(from, this.ago(30)), this.ago(7));
        else createdAt = this.between(from, maxDate(from, this.ago(30)));

        // Sentiment follows the kitchen's quality; the suspended / banned accounts were harsh.
        let sentiment;
        const q = author.status === "active" ? def.quality * 0.8 : 0.2;
        const s = this.r();
        if (s < q) sentiment = "liked";
        else if (s < q + (1 - q) * 0.65) sentiment = "fine";
        else sentiment = "disliked";

        const favorite = sentiment !== "disliked" && this.chance(0.65)
          ? this.sample(popular.length ? popular : available, this.int(1, 2))
          : [];
        const dishName = (favorite[0] || this.pick(popular) || this.pick(available))?.name || "food";
        const labels = sentiment === "liked"
          ? this.sample(this.labels.good, this.int(1, 3))
          : sentiment === "fine"
            ? [...this.sample(this.labels.good, 1), ...this.sample(this.labels.bad, 1)]
            : this.sample(this.labels.bad, this.int(1, 2));
        const friends = [...author.following].map((k) => this.user(k)).filter((u) => u?.status === "active");
        const companions = this.chance(0.3) ? this.sample(friends, this.int(1, 2)) : [];
        const photoPool = unique([
          ...available.map((i) => i.image).filter(Boolean),
          ...entry.doc.coverImages.slice(1),
        ]);
        const photos = this.chance(0.35) ? this.sample(photoPool, this.int(1, 3)) : [];

        rows.push({
          author,
          restaurant: entry,
          data: {
            restaurant: entry.doc._id,
            user: author.doc._id,
            sentiment,
            score: SENTIMENT_SCORE[sentiment],
            comment: this.reviewText(sentiment, dishName, entry.doc.city),
            photos,
            companions: companions.map((c) => c.doc._id),
            labels,
            favoriteDishes: favorite.map((i) => ({ name: i.name, menuItem: i._id })),
            visitDate: new Date(createdAt.getTime() - this.int(0, 4) * DAY - this.int(1, 5) * HOUR),
            status: "approved",
            createdAt,
            updatedAt: createdAt,
          },
        });
      }
    }

    // Moderation mix: the suspended account's fake reviews were rejected, the banned
    // account's review is flagged, the newest ones wait in the queue, a few harsh
    // ones were auto-flagged, and three published ones are posted in stealth mode.
    const adminId = this.admin?._id || null;
    const moderate = (row, status, note) => {
      row.data.status = status;
      row.data.moderationNote = note;
      if (status === "rejected") {
        row.data.moderatedBy = adminId;
        row.data.moderatedAt = new Date(Math.min(row.data.createdAt.getTime() + DAY, this.now.getTime() - HOUR));
        row.data.updatedAt = row.data.moderatedAt;
      }
    };
    rows.filter((r) => r.author.key === "john").forEach((r) => moderate(r, "rejected", "Fake review — part of a batch of copied reviews."));
    rows.filter((r) => r.author.key === "elvin").forEach((r) => moderate(r, "flagged", "Inappropriate language towards the staff."));
    const byNewest = [...rows].sort((a, b) => b.data.createdAt - a.data.createdAt);
    byNewest
      .filter((r) => r.data.status === "approved" && r.author.status === "active" && r.data.createdAt > this.ago(3))
      .slice(0, 5)
      .forEach((r) => moderate(r, "pending", ""));
    byNewest
      .filter((r) => r.data.status === "approved" && r.data.sentiment === "disliked" && r.author.status === "active")
      .slice(0, 3)
      .forEach((r) => moderate(r, "flagged", "Auto-flagged: low rating"));
    byNewest
      .filter((r) => r.data.status === "approved" && r.data.sentiment !== "liked")
      .filter((_, i) => i % 5 === 2)
      .slice(0, 3)
      .forEach((r) => {
        r.data.isStealth = true;
      });

    // Likes on published reviews (followers of the author are the likeliest).
    const active = this.activeUsers();
    for (const row of rows) {
      if (row.data.status !== "approved") continue;
      const recent = row.data.createdAt > this.ago(30);
      const n = this.int(0, recent ? 5 : 3) + (row.data.sentiment === "liked" ? 1 : 0);
      const likers = this.sample(
        active.filter((u) => u !== row.author && u.createdAt < row.data.createdAt),
        n,
        (u) => (u.following.has(row.author.key) ? 4 : 1),
      );
      row.likers = likers.map((u) => ({ user: u, at: this.between(row.data.createdAt, this.now, 1.2) }));
      row.data.likes = likers.map((u) => u.doc._id);
    }

    for (const row of rows.sort((a, b) => a.data.createdAt - b.data.createdAt)) {
      const doc = await createSeed(Review, row.data);
      const review = { doc, author: row.author, restaurant: row.restaurant, likers: row.likers || [], viewers: new Set() };
      this.reviews.push(review);
      review.likers.forEach(({ user, at }) => {
        review.viewers.add(user.key);
        if (at > this.ago(21)) {
          this.note({ recipient: row.author.doc._id, actor: user.doc._id, type: "review_like", review: doc._id, restaurant: row.restaurant.doc._id, message: "liked your review.", at });
        }
      });
      // The reviewer looked at the place that day.
      this.userView(row.author, row.restaurant, new Date(row.data.createdAt.getTime() - 20 * MIN));
      // "X visited <restaurant> — a place on your list" for followers who listed it.
      if (doc.status === "approved" && doc.createdAt > this.ago(14)) this.listVisitNotes(review);
    }
    this.counts.reviews = this.reviews.length;
    this.counts.likes = this.reviews.reduce((s, r) => s + r.likers.length, 0);
  }

  listVisitNotes(review) {
    const restaurantId = String(review.restaurant.doc._id);
    this.followersOf(review.author).forEach((follower) => {
      const list = this.lists.find(
        (l) => String(l.doc.owner) === String(follower.doc._id) && l.doc.items.some((it) => String(it.restaurant) === restaurantId),
      );
      if (!list) return;
      this.note({
        recipient: follower.doc._id,
        actor: review.author.doc._id,
        type: "list_visit",
        restaurant: review.restaurant.doc._id,
        list: list.doc._id,
        review: review.doc._id,
        at: new Date(review.doc.createdAt.getTime() + 2 * MIN),
      });
    });
  }

  // ------------------------------------------------------------ comments + shares

  async seedComments() {
    const active = this.activeUsers();
    const rows = [];
    const personal = (text, dish) => text.replace(/\{dish\}/g, dish);

    for (const review of this.reviews) {
      const { doc } = review;
      if (doc.status !== "approved" || doc.isStealth || review.author.status !== "active") continue;
      if (!this.chance(doc.createdAt > this.ago(30) ? 0.55 : 0.3)) continue;
      const dish = doc.favoriteDishes[0]?.name || review.restaurant.doc.popularDishes?.[0]?.name || "food";
      const people = active.filter((u) => u !== review.author && u.createdAt < doc.createdAt);
      const commenters = this.sample(people, this.int(1, 3), (u) => (u.following.has(review.author.key) ? 3 : 1));

      commenters.forEach((user) => {
        const at = this.between(new Date(doc.createdAt.getTime() + 20 * MIN), this.now, 1.3);
        let text = personal(this.pick(DEMO.COMMENT_TEXT), dish);
        const mentions = [];
        // Tag a friend who would like the place.
        const friend = this.chance(0.25)
          ? this.pick([...user.following].map((k) => this.user(k)).filter((f) => f?.status === "active" && f !== review.author))
          : null;
        if (friend) {
          text = `@${fullName(friend.doc)} ${text}`;
          mentions.push(friend);
        }
        const top = seedDoc(Comment, {
          review: doc._id,
          user: user.doc._id,
          text,
          mentions: mentions.map((m) => m.doc._id),
          createdAt: at,
          updatedAt: at,
        });
        const likers = this.sample(active.filter((u) => u !== user), this.int(0, 2));
        top.likes = likers.map((u) => u.doc._id);
        top.likeCount = likers.length;
        rows.push({ comment: top, user, review, mentions, likers, replyTo: null });

        // Replies (two-level threads; the review author answers most).
        if (this.chance(0.45)) {
          let last = at;
          for (let k = 0; k < this.int(1, 2); k += 1) {
            const replier = this.chance(0.6) ? review.author : this.pick(people.filter((u) => u !== user));
            if (!replier) break;
            last = this.between(new Date(last.getTime() + 10 * MIN), this.now, 1.2);
            const reply = seedDoc(Comment, {
              review: doc._id,
              user: replier.doc._id,
              parent: top._id,
              replyTo: user.doc._id,
              text: `@${fullName(user.doc)} ${personal(this.pick(DEMO.REPLY_TEXT), dish)}`,
              mentions: [user.doc._id],
              createdAt: last,
              updatedAt: last,
            });
            const replyLikers = this.sample(active.filter((u) => u !== replier), this.int(0, 1));
            reply.likes = replyLikers.map((u) => u.doc._id);
            reply.likeCount = replyLikers.length;
            rows.push({ comment: reply, user: replier, review, mentions: [], likers: replyLikers, replyTo: user });
          }
        }
      });
    }

    await Comment.insertMany(rows.map((r) => r.comment));
    rows.forEach(({ comment, user, review, mentions, likers, replyTo }) => {
      review.viewers.add(user.key);
      // The same fan-out as the comment endpoint: one notification per person.
      const notified = new Set([user.key]);
      const send = (to, type, message) => {
        if (!to || notified.has(to.key)) return;
        notified.add(to.key);
        this.note({
          recipient: to.doc._id,
          actor: user.doc._id,
          type,
          message,
          review: review.doc._id,
          comment: comment._id,
          restaurant: review.restaurant.doc._id,
          at: comment.createdAt,
        });
      };
      if (replyTo) send(replyTo, "reply", "replied to your comment.");
      send(review.author, "comment", "commented on your review.");
      mentions.forEach((m) => send(m, "mention", "mentioned you in a comment."));
      // Comment likes (legacy "review" type with reason comment_like, like the endpoint).
      likers.forEach((liker) => {
        const at = this.between(comment.createdAt, this.now);
        if (at < this.ago(21)) return;
        this.note({
          recipient: user.doc._id,
          actor: liker.doc._id,
          type: "review",
          message: "liked your comment.",
          review: review.doc._id,
          comment: comment._id,
          restaurant: review.restaurant.doc._id,
          data: { reason: "comment_like" },
          at,
        });
      });
    });
    this.comments = rows;
    this.counts.comments = rows.length;
    this.counts.replies = rows.filter((r) => r.replyTo).length;
  }

  /** In-app shares of reviews, restaurants and lists ("Send a message"). */
  seedShares() {
    const active = this.activeUsers();
    const connections = (u) => active.filter((o) => o !== u && this.connected(u, o));
    let shares = 0;

    const published = this.reviews.filter((r) => r.doc.status === "approved" && !r.doc.isStealth);
    this.sample(published, Math.min(16, published.length), (r) => (r.doc.createdAt > this.ago(30) ? 3 : 1)).forEach((review) => {
      const sharer = this.pick(active.filter((u) => u !== review.author && connections(u).length));
      if (!sharer) return;
      const recipients = this.sample(connections(sharer).filter((u) => u !== review.author), this.int(1, 2));
      const at = this.between(review.doc.createdAt, this.now, 1.3);
      recipients.forEach((to) => {
        review.viewers.add(to.key);
        this.note({
          recipient: to.doc._id,
          actor: sharer.doc._id,
          type: "share",
          message: "shared a review with you.",
          review: review.doc._id,
          restaurant: review.restaurant.doc._id,
          data: { kind: "review" },
          at,
        });
      });
      review.shares = (review.shares || 0) + recipients.length;
      shares += recipients.length;
    });

    this.sample(this.liveRestaurants(), 7, (r) => r.def.hot + 1).forEach((restaurant) => {
      const sharer = this.pick(active.filter((u) => connections(u).length));
      const to = sharer && this.pick(connections(sharer));
      if (!to) return;
      this.note({ recipient: to.doc._id, actor: sharer.doc._id, type: "share", restaurant: restaurant.doc._id, at: this.between(this.ago(20)) });
      shares += 1;
    });

    const shareable = this.lists.filter((l) => l.custom && l.doc.privacy !== "private");
    this.sample(shareable, Math.min(5, shareable.length)).forEach((list) => {
      const to = this.pick(connections(list.owner));
      if (!to) return;
      this.note({ recipient: to.doc._id, actor: list.owner.doc._id, type: "share", list: list.doc._id, at: this.between(list.doc.createdAt) });
      shares += 1;
    });
    this.counts.shares = shares;
  }

  /** Derived review counters: comments / replies (from Comment), shares and viewers. */
  async syncReviewCounters() {
    await recomputeCommentCounts(this.reviews.map((r) => r.doc._id));
    const ops = this.reviews
      .filter((r) => r.shares || r.viewers.size)
      .map((r) => ({
        updateOne: {
          filter: { _id: r.doc._id },
          // Views = the people known to have opened it (likers, commenters, share recipients).
          update: { $set: { shareCount: r.shares || 0, viewCount: r.viewers.size } },
        },
      }));
    if (ops.length) await Review.bulkWrite(ops, { timestamps: false });
  }

  // ------------------------------------------------------------ restaurant follows

  async seedRestaurantFollows() {
    const rows = [];
    for (const [key, restaurantKeys] of Object.entries(DEMO.RESTAURANT_FOLLOWS)) {
      const user = this.user(key);
      if (!user || user.status === "pending") continue;
      restaurantKeys
        .map((k) => this.restaurants.get(k))
        .filter((r) => r?.live)
        .forEach((restaurant) => {
          const at = this.between(maxDate(user.createdAt, restaurant.createdAt), this.now, 1.2);
          rows.push({ user: user.doc._id, restaurant: restaurant.doc._id, createdAt: at });
          this.restaurantFollows.push({ user, restaurant, at });
        });
    }
    await insertSeed(RestaurantFollow, rows);

    // Followers hear about discounts and new dishes (RestaurantFollowService).
    const newDishes = new Set(["chinaTown", "brunchClub", "pastaBasta"]);
    this.restaurantFollows.forEach(({ user, restaurant, at }) => {
      const discount = restaurant.doc.discountPercent;
      if (discount > 0) {
        this.note({
          recipient: user.doc._id,
          type: "restaurant_offer",
          restaurant: restaurant.doc._id,
          data: { discountPercent: discount },
          at: this.between(maxDate(at, this.ago(21)), this.now),
        });
      }
      if (newDishes.has(restaurant.key)) {
        this.note({
          recipient: user.doc._id,
          type: "restaurant_menu",
          restaurant: restaurant.doc._id,
          at: this.between(maxDate(at, this.ago(6)), this.now),
        });
      }
    });
    this.counts.restaurantFollows = rows.length;
  }

  // ------------------------------------------------------------ moderation

  async seedReports() {
    const adminId = this.admin?._id || null;
    const byStatus = (status) =>
      this.reviews.filter((r) => r.doc.status === status).sort((a, b) => b.doc.createdAt - a.doc.createdAt);
    const customLists = this.lists.filter((l) => l.custom);
    let created = 0;

    for (const def of DEMO.REPORTS) {
      const reporter = this.user(def.reporter);
      if (!reporter) continue;
      const [kind, a, b] = def.target.split(":");
      let target = null;
      if (kind === "review") {
        const review = byStatus(a).filter((r) => r.author !== reporter)[Number(b)];
        if (review) {
          target = {
            id: review.doc._id,
            label: `Review #${review.doc.number} · ${review.restaurant.doc.name}`,
            owner: review.author.doc._id,
            after: review.doc.createdAt,
          };
        }
      } else if (kind === "restaurant") {
        const restaurant = this.restaurants.get(a);
        if (restaurant) target = { id: restaurant.doc._id, label: restaurant.doc.name, owner: null, after: restaurant.createdAt };
      } else if (kind === "user") {
        const user = this.user(a);
        if (user && user !== reporter) target = { id: user.doc._id, label: fullName(user.doc), owner: user.doc._id, after: user.createdAt };
      } else if (kind === "list") {
        const list = customLists[Number(a)];
        if (list && list.owner !== reporter) target = { id: list.doc._id, label: list.doc.name, owner: list.owner.doc._id, after: list.doc.createdAt };
      }
      if (!target) continue;

      const createdAt = maxDate(this.ago(def.daysAgo, this.int(1, 8)), new Date(target.after.getTime() + HOUR));
      const closed = ["resolved", "dismissed"].includes(def.status);
      const resolvedAt = closed ? new Date(Math.min(createdAt.getTime() + this.int(4, 30) * HOUR, this.now.getTime() - HOUR)) : null;
      const report = await createSeed(Report, {
        targetType: kind,
        targetId: target.id,
        targetLabel: target.label,
        targetOwner: target.owner,
        reason: this.reason(def.reason),
        description: def.description,
        reporter: reporter.doc._id,
        status: def.status,
        resolutionNote: def.note || "",
        action: closed ? def.action || "none" : "none",
        resolvedBy: closed ? adminId : null,
        resolvedAt,
        createdAt,
        updatedAt: resolvedAt || createdAt,
      });
      created += 1;

      // Admin bell: "New report #N" for everything still waiting.
      if (!closed) {
        this.admins.forEach((admin) =>
          this.note({
            recipient: admin._id,
            actor: reporter.doc._id,
            type: "system",
            title: "New report",
            message: `New report #${report.number}: ${report.reason} (${kind})`,
            data: { reportId: String(report._id) },
            at: createdAt,
          }),
        );
      } else {
        // The reporter hears back.
        const about = report.targetLabel || `a ${kind}`;
        const suffix = def.note ? ` Note from our team: ${def.note}` : "";
        this.note({
          recipient: reporter.doc._id,
          type: "system",
          title: "Report reviewed",
          message: def.status === "resolved"
            ? `Your report about ${about} was reviewed and action was taken.${suffix}`
            : `Your report about ${about} was reviewed. No action was taken.${suffix}`,
          data: { reportId: String(report._id), reportStatus: def.status },
          at: resolvedAt,
        });
      }
    }
    this.counts.reports = created;
  }

  async seedLabelRequests() {
    const adminId = this.admin?._id || null;
    const rows = [];
    for (const def of DEMO.LABEL_REQUESTS) {
      const user = this.user(def.user);
      if (!user) continue;
      const createdAt = this.between(maxDate(user.createdAt, this.ago(25)), this.now);
      let status = def.status;
      let taxonomy = null;
      if (status === "approved") {
        const match = this.catalog.reviewLabel?.get(norm(def.label));
        if (match) taxonomy = match._id;
        else status = "pending"; // nothing to link to in this catalog
      }
      const reviewed = status !== "pending";
      rows.push({
        user: user.doc._id,
        label: def.label,
        group: def.group,
        status,
        adminNote: reviewed ? def.adminNote || "" : "",
        taxonomy,
        reviewedBy: reviewed ? adminId : null,
        reviewedAt: reviewed ? this.between(createdAt) : null,
        createdAt,
        updatedAt: createdAt,
      });
    }
    await insertSeed(ReviewLabelRequest, rows);
    this.counts.labelRequests = rows.length;
  }

  /** System notifications: the welcome broadcast, warnings, hidden reviews, admin alerts. */
  systemNotes() {
    this.activeUsers().forEach((u) =>
      this.note({
        recipient: u.doc._id,
        type: "system",
        title: DEMO.BROADCAST.title,
        message: DEMO.BROADCAST.message,
        data: { kind: "broadcast" },
        at: maxDate(this.ago(14), new Date(u.createdAt.getTime() + HOUR)),
      }),
    );
    this.activeUsers().forEach((u) =>
      (u.doc.warnings || []).forEach((w) =>
        this.note({
          recipient: u.doc._id,
          actor: this.admin?._id || null,
          type: "system",
          title: "You received a warning",
          message: `The Yumio team issued you a warning: ${w.reason}`,
          data: { kind: "warning" },
          at: w.createdAt,
        }),
      ),
    );
    const tural = this.user("tural");
    if (tural) {
      this.admins.forEach((admin) =>
        this.note({
          recipient: admin._id,
          actor: tural.doc._id,
          type: "system",
          title: "New user awaiting approval",
          message: `${fullName(tural.doc)} signed up and is awaiting approval.`,
          data: { kind: "new_user", userId: String(tural.doc._id), link: `/dashboard/users?user=${tural.doc._id}` },
          at: new Date(tural.createdAt.getTime() + MIN),
        }),
      );
    }
  }

  async insertNotifications() {
    await insertSeed(Notification, this.notes);
    this.counts.notifications = this.notes.length;
    this.counts.notificationTypes = unique(this.notes.map((n) => n.type)).length;
  }

  // ------------------------------------------------------------ views + searches

  /** A signed-in user's profile view (their "Recently viewed"). */
  userView(user, restaurant, at) {
    if (!restaurant?.live || !user || at < this.ago(90) || at > this.now) return;
    if (!this.viewRows) this.viewRows = new Map();
    const viewedAt = new Date(Math.max(at.getTime(), restaurant.createdAt.getTime() + HOUR));
    const day = RestaurantStatsService.dayKey(viewedAt);
    const viewer = `u:${user.doc._id}`;
    const key = `${restaurant.doc._id}|${viewer}|${day}`;
    if (this.viewRows.has(key)) return;
    this.viewRows.set(key, {
      restaurant: restaurant.doc._id,
      viewer,
      user: user.doc._id,
      day,
      viewedAt,
      // Nigar cleared her history a while ago (still counted in the statistics).
      inHistory: !(user.key === "nigar" && viewedAt < this.ago(10)),
      createdAt: viewedAt,
    });
    if (!this.viewedBy.has(user.key)) this.viewedBy.set(user.key, new Set());
    this.viewedBy.get(user.key).add(restaurant.key);
  }

  async seedViews() {
    if (!this.viewRows) this.viewRows = new Map();
    const live = this.liveRestaurants();

    // Members browsing over the last three weeks (their Recently viewed rails).
    this.activeUsers().forEach((user) => {
      const prefs = new Set(user.doc.preferences?.cuisines || []);
      const n = user.key === "lala" ? 14 : this.int(5, 12);
      this.sample(live, n, (r) => r.def.hot + (r.doc.cuisines.some((c) => prefs.has(c)) ? 6 : 0) + (r.doc.city === user.doc.city ? 4 : 0))
        .forEach((restaurant) => this.userView(user, restaurant, this.between(maxDate(this.ago(21), user.createdAt), this.now, 1.5)));
    });

    // Guests (anonymous sessions) over 90 days; "rising" places pick up this week.
    const guests = Array.from({ length: 400 }, (_, i) =>
      `s:${crypto.createHash("sha256").update(`yumio-demo-guest-${i}`).digest("hex").slice(0, 32)}`,
    );
    const dayStart = (daysAgo) => {
      const d = this.ago(daysAgo);
      d.setHours(8, 0, 0, 0);
      return d;
    };
    live.forEach((restaurant) => {
      const { hot, rising } = restaurant.def;
      const closedFactor = restaurant.doc.temporarilyClosed ? 0.3 : 1;
      for (let d = 0; d < 90; d += 1) {
        const start = dayStart(d);
        if (start < restaurant.createdAt) break;
        const base = d < 7 ? 0.7 * rising : d < 30 ? 0.7 : 0.3;
        const count = Math.floor(hot * base * 0.7 * closedFactor + this.r());
        for (let i = 0; i < count; i += 1) {
          const viewedAt = new Date(Math.min(start.getTime() + this.int(0, 15 * 60) * MIN, this.now.getTime() - MIN));
          const viewer = this.pick(guests);
          const day = RestaurantStatsService.dayKey(viewedAt);
          const key = `${restaurant.doc._id}|${viewer}|${day}`;
          if (this.viewRows.has(key)) continue;
          this.viewRows.set(key, { restaurant: restaurant.doc._id, viewer, user: null, day, viewedAt, inHistory: false, createdAt: viewedAt });
        }
      }
    });

    const rows = [...this.viewRows.values()].map((row) => ({ ...row, ...SEED }));
    for (let i = 0; i < rows.length; i += VIEW_CHUNK) {
      await RestaurantView.collection.insertMany(rows.slice(i, i + VIEW_CHUNK), { ordered: false });
    }
    this.counts.views = rows.length;
  }

  async seedSearches() {
    const rows = [];
    const typed = DEMO.SEARCHES.filter((s) => {
      if (s.type === "cuisine") return this.names("cuisine", [s.label]).length > 0;
      if (s.type === "mood") return this.names("mood", [s.label]).length > 0;
      return true;
    });
    const searchers = ["lala", "ali", "jane", "leyla", "kamran", "sevinj", "gunel", "emil", "nargiz", "rashad", "aysel", "farid"];
    searchers.forEach((key) => {
      const user = this.user(key);
      if (!user || user.status !== "active") return;
      const entries = this.sample(typed, this.int(2, 5)).map((s) => ({
        type: s.type,
        label: s.type === "cuisine" ? this.names("cuisine", [s.label])[0] : s.type === "mood" ? this.names("mood", [s.label])[0] : s.label,
        query: s.label,
        subtitle: s.subtitle || "",
        restaurant: null,
        ...(s.coordinates ? { coordinates: s.coordinates } : {}),
      }));
      const viewed = [...(this.viewedBy.get(key) || [])].map((k) => this.restaurants.get(k)).filter((r) => r?.live);
      this.sample(viewed, this.int(1, 3)).forEach((r) =>
        entries.push({ type: "restaurant", label: r.doc.name, query: r.doc.name, subtitle: "", restaurant: r.doc._id }),
      );
      entries.forEach((entry) => {
        const updatedAt = this.between(maxDate(this.ago(20), user.createdAt), this.now, 1.3);
        rows.push({
          ...entry,
          user: user.doc._id,
          key: entry.type === "restaurant" ? `restaurant:${entry.restaurant}` : `${entry.type}:${foldText(entry.label)}`,
          createdAt: new Date(updatedAt.getTime() - this.int(0, 6) * DAY),
          updatedAt,
        });
      });
    });
    await insertSeed(SearchHistory, rows);
    this.counts.searches = rows.length;
  }

  // ------------------------------------------------------------ derived aggregates

  async derive() {
    const ids = [...this.restaurants.values()].map((r) => r.doc._id);
    await this.syncReviewCounters();
    await recomputeSaveCounts(ids);
    await recomputeViewAndFollowerCounts(ids);
    await ReviewService.recomputeAll();
    await RestaurantStatsService.refreshAll();
    await CatalogService.syncPriceLevels();
  }

  async run() {
    await this.loadContext();
    await this.seedRestaurants();
    await this.seedMenus();
    await this.seedUsers();
    await this.seedFollows();
    await this.seedLists();
    await this.seedReviews();
    await this.seedComments();
    this.seedShares();
    await this.seedRestaurantFollows();
    await this.seedReports();
    await this.seedLabelRequests();
    this.systemNotes();
    await this.insertNotifications();
    await this.seedViews();
    await this.seedSearches();
    await this.derive();
    return this.counts;
  }
}

// =====================================================================
// Public API
// =====================================================================

class SeedService {
  static DEMO_PASSWORD = DEMO_PASSWORD;
  static running = null;

  static assertEnabled() {
    if (!PlatformService.isDemoDataEnabled()) {
      throw httpError(403, "Demo data is disabled in production (set ENABLE_DEMO_SEED=true to allow it)");
    }
  }

  /** How many demo documents currently exist. */
  static async counts() {
    const models = {
      users: User,
      restaurants: Restaurant,
      menuItems: MenuItem,
      reviews: Review,
      comments: Comment,
      lists: FavoriteList,
      notifications: Notification,
      reports: Report,
      labelRequests: ReviewLabelRequest,
      restaurantFollows: RestaurantFollow,
      views: RestaurantView,
      searches: SearchHistory,
    };
    const values = await Promise.all(Object.values(models).map(countSeed));
    return Object.fromEntries(Object.keys(models).map((key, i) => [key, values[i]]));
  }

  /**
   * Remove the demo data (documents tagged isSeed) and every reference real
   * data holds to it. Also removes what someone created while signed in as a
   * demo account. Returns deleted counts.
   */
  static async clearAll() {
    this.assertEnabled();
    const [userIds, restaurantIds, seedReviewIds, seedListIds, commentIds] = await Promise.all([
      seedIds(User),
      seedIds(Restaurant),
      seedIds(Review),
      seedIds(FavoriteList),
      seedIds(Comment),
    ]);
    // What is removed (reported up-front: related rows go before the tagged sweep below).
    const [removed, menuCategories] = await Promise.all([this.counts(), countSeed(MenuCategory)]);
    const now = new Date();
    const reviewIds = [...seedReviewIds];
    const listIds = [...seedListIds];
    const touchedRestaurants = new Set(); // real restaurants whose derived counters change
    const touchedReviews = new Set(); // real reviews whose comment counters change

    if (userIds.length) {
      // Social graph + membership of real accounts / lists.
      await User.updateMany({ following: { $in: userIds } }, { $pull: { following: { $in: userIds } } }, { timestamps: false });
      await User.updateMany(
        { dismissedSuggestions: { $in: userIds } },
        { $pull: { dismissedSuggestions: { $in: userIds } } },
        { timestamps: false },
      );
      await User.updateMany({ invitedBy: { $in: userIds } }, { $set: { invitedBy: null } }, { timestamps: false });
      await FavoriteList.updateMany(
        { "collaborators.user": { $in: userIds } },
        { $pull: { collaborators: { user: { $in: userIds } } } },
      );
      await FavoriteList.updateMany(
        { followers: { $in: userIds } },
        [{ $set: { followers: { $setDifference: ["$followers", userIds] } } }, { $set: { saveCount: { $size: "$followers" } } }],
        { updatePipeline: true },
      );
      // Likes on real reviews / comments.
      for (const Model of [Review, Comment]) {
        await Model.updateMany(
          { likes: { $in: userIds } },
          [{ $set: { likes: { $setDifference: ["$likes", userIds] } } }, { $set: { likeCount: { $size: "$likes" } } }],
          { updatePipeline: true },
        );
      }
      // Content made while signed in as a demo account (not tagged): it goes with the account.
      const strayReviews = await Review.find({ user: { $in: userIds }, isSeed: { $ne: true } }, "restaurant").lean();
      strayReviews.forEach((r) => {
        touchedRestaurants.add(String(r.restaurant));
        reviewIds.push(r._id);
      });
      await Review.deleteMany({ _id: { $in: strayReviews.map((r) => r._id) } });
      const strayLists = await FavoriteList.find({ owner: { $in: userIds }, isSeed: { $ne: true } }, "items.restaurant").lean();
      strayLists.forEach((l) => {
        listIds.push(l._id);
        (l.items || []).forEach((it) => touchedRestaurants.add(String(it.restaurant)));
      });
      await FavoriteList.deleteMany({ _id: { $in: strayLists.map((l) => l._id) } });
      await Report.updateMany({ reporter: { $in: userIds }, isSeed: { $ne: true } }, { $set: { reporter: null } });
      // Comments by demo accounts on real reviews (+ replies hanging off them).
      const stray = await Comment.find({ user: { $in: userIds }, review: { $nin: reviewIds } }, "review parent").lean();
      stray.forEach((c) => touchedReviews.add(String(c.review)));
      const strayIds = stray.map((c) => c._id);
      await Comment.deleteMany({ $or: [{ _id: { $in: strayIds } }, { parent: { $in: strayIds } }] });
      // Restaurant follows by demo accounts.
      const follows = await RestaurantFollow.find({ user: { $in: userIds } }, "restaurant").lean();
      follows.forEach((f) => touchedRestaurants.add(String(f.restaurant)));
      await RestaurantFollow.deleteMany({ user: { $in: userIds } });
      await RestaurantView.deleteMany({ user: { $in: userIds } });
      await SearchHistory.deleteMany({ user: { $in: userIds } });
      await ReviewLabelRequest.deleteMany({ user: { $in: userIds } });
    }

    if (restaurantIds.length) {
      await FavoriteList.updateMany(
        { "items.restaurant": { $in: restaurantIds } },
        { $pull: { items: { restaurant: { $in: restaurantIds } } } },
      );
      // Real users' reviews of demo restaurants are archived with the restaurants.
      await Review.updateMany(
        { restaurant: { $in: restaurantIds }, isDeleted: false, isSeed: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: now } },
      );
      await MenuItem.deleteMany({ restaurant: { $in: restaurantIds } });
      await MenuCategory.deleteMany({ restaurant: { $in: restaurantIds } });
      await RestaurantView.deleteMany({ restaurant: { $in: restaurantIds } });
      await SearchHistory.deleteMany({ restaurant: { $in: restaurantIds } });
      await RestaurantFollow.deleteMany({ restaurant: { $in: restaurantIds } });
    }
    // Every comment on a demo review (whoever wrote it).
    if (reviewIds.length) await Comment.deleteMany({ review: { $in: reviewIds } });

    // Notifications about / from demo documents (driver call: isSeed is not in the schema).
    const notifications = await Notification.collection.deleteMany({
      $or: [
        SEED,
        { recipient: { $in: userIds } },
        { actor: { $in: userIds } },
        { restaurant: { $in: restaurantIds } },
        { review: { $in: reviewIds } },
        { list: { $in: listIds } },
        { comment: { $in: commentIds } },
      ],
    });
    // Real reports about demo content are closed, not deleted.
    const demoTargets = [...userIds, ...restaurantIds, ...reviewIds, ...listIds];
    if (demoTargets.length) {
      await Report.collection.updateMany(
        { targetId: { $in: demoTargets }, status: { $in: ["open", "in_review"] }, isSeed: { $ne: true } },
        { $set: { status: "dismissed", resolvedAt: now, resolutionNote: "Demo data removed" } },
      );
    }

    for (const Model of [
      Review,
      Comment,
      FavoriteList,
      Restaurant,
      MenuItem,
      MenuCategory,
      User,
      Report,
      ReviewLabelRequest,
      RestaurantFollow,
      RestaurantView,
      SearchHistory,
    ]) {
      await dropSeed(Model);
    }
    const counts = { ...removed, menuCategories, notifications: notifications.deletedCount };

    // Real documents whose derived counters changed.
    if (touchedRestaurants.size) {
      const ids = await Restaurant.distinct("_id", { _id: { $in: [...touchedRestaurants] } });
      await recomputeSaveCounts(ids);
      await recomputeViewAndFollowerCounts(ids);
    }
    const realReviews = await Review.distinct("_id", { _id: { $in: [...touchedReviews] } });
    await recomputeCommentCounts(realReviews);
    if (Object.values(counts).some(Boolean)) {
      await ReviewService.recomputeAll();
      await RestaurantStatsService.refreshAll();
    }
    return counts;
  }

  /** Replace the demo data with a fresh set. Returns created counts. */
  static async seedAll() {
    this.assertEnabled();
    if (this.running) throw httpError(409, "Demo data is already being loaded — try again in a moment");
    this.running = (async () => {
      // Catalog defaults (cuisines, features, cities, ...) first — never overwrites admin edits.
      await CatalogService.ensureDefaults();
      await this.clearAll();
      return new DemoSeeder().run();
    })();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }
}

export { SeedService };
