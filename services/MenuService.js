import { Restaurant, MenuCategory, MenuItem } from "#models";
import { menuItemSearchKeys } from "#models/menuItem.model.js";
import { menuCategorySearchKey } from "#models/menuCategory.model.js";
import { foldText } from "#utils/search.js";
import { FileService } from "./FileService.js";

/**
 * MenuService — restaurant menus (MenuCategory + MenuItem).
 *
 *  - menuOf(): the grouped menu for the public "Explore full menu" screen and
 *    the admin editor.
 *  - visibleItemFilter(): the public item clause (available, category not
 *    hidden) shared by the menu, dish search, suggestions and Home rows.
 *  - syncRestaurant(): refreshes the derived Restaurant.popularDishes (popular,
 *    visible items) and menuItemCount after every menu / category change.
 *  - importLegacyPopularDishes(): one-off boot migration of the old embedded
 *    popularDishes into MenuItems (idempotent via Restaurant.menuImportedAt).
 *  - applyLegacyPopularDishes(): keeps the old admin form (PUT
 *    /restaurants/:id with popularDishes) working by mapping it onto items.
 *  - deleteImageIfUnused(): removes an uploaded file nobody references.
 *  - refreshSearchKeys(): boot backfill of the folded item / section search
 *    keys (full-text restaurant search).
 */

const KEY_BATCH = 500;

// Uploaded menu photos / dish images — same folder as the "menus" upload kind
// of POST /api/uploads/:kind.
const MENU_UPLOAD_DIR = "uploads/menus";
// Files shipped with the app — never deleted.
const PROTECTED_DIR = "uploads/catalog/defaults/";

const BY_ORDER = { order: 1, createdAt: 1 };

// The trailing group of items without a category.
const OTHER_GROUP = { name: "Other", translations: { az: { name: "Digər" }, ru: { name: "Другое" } } };

// Public item shape.
const toItem = (item) => ({
  _id: item._id,
  category: item.category ?? null,
  name: item.name,
  description: item.description || "",
  price: item.price ?? 0,
  image: item.image ?? null,
  dietary: item.dietary || [],
  isPopular: !!item.isPopular,
  isAvailable: item.isAvailable !== false,
  order: item.order ?? 0,
  translations: item.translations || {},
});

// Only the az / ru `name` of an item (popularDishes mirror the name, nothing else).
const nameTranslations = (translations) =>
  Object.fromEntries(Object.entries(translations || {}).map(([lang, entry]) => [lang, { name: entry?.name || "" }]));

class MenuService {
  static MENU_UPLOAD_DIR = MENU_UPLOAD_DIR;
  static toItem = toItem;

  /**
   * Mongo filter for the menu items the public sees: available and not in a
   * hidden (inactive) category — items without a category stay visible.
   * `extra` narrows it (restaurant, isPopular, …).
   */
  static async visibleItemFilter(extra = {}) {
    const scope = { isActive: false };
    if (extra.restaurant) scope.restaurant = extra.restaurant;
    const hidden = await MenuCategory.distinct("_id", scope);
    const filter = { ...extra, isAvailable: true };
    if (hidden.length) filter.category = { $nin: hidden };
    return filter;
  }

  /**
   * Grouped menu of a restaurant.
   * options: { includeHidden } — admin view (inactive categories + unavailable items).
   * → { categories: [{ _id, name, description, order, isActive, itemCount, items }],
   *     popular: [items], itemCount }
   * Items without a category are returned in a trailing { _id: null, name: "Other" }
   * group (with az / ru names) when there are any.
   */
  static async menuOf(restaurantId, { includeHidden = false } = {}) {
    const categoryFilter = { restaurant: restaurantId };
    const itemFilter = { restaurant: restaurantId };
    if (!includeHidden) {
      categoryFilter.isActive = true;
      itemFilter.isAvailable = true;
    }
    const [categories, items] = await Promise.all([
      MenuCategory.find(categoryFilter).sort(BY_ORDER).lean(),
      MenuItem.find(itemFilter).sort(BY_ORDER).lean(),
    ]);

    const known = new Set(categories.map((c) => String(c._id)));
    const byCategory = new Map();
    const loose = [];
    items.forEach((item) => {
      const key = item.category ? String(item.category) : null;
      if (key && known.has(key)) {
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key).push(toItem(item));
      } else if (!key || includeHidden) {
        // Items of a hidden category stay hidden publicly.
        loose.push(toItem(item));
      }
    });

    const groups = categories.map((c) => {
      const list = byCategory.get(String(c._id)) || [];
      return {
        _id: c._id,
        name: c.name,
        description: c.description || "",
        order: c.order ?? 0,
        isActive: c.isActive !== false,
        itemCount: list.length,
        items: list,
        translations: c.translations || {},
      };
    });
    const visibleGroups = includeHidden ? groups : groups.filter((g) => g.items.length);
    if (loose.length) {
      visibleGroups.push({
        _id: null,
        name: OTHER_GROUP.name,
        description: "",
        order: groups.length,
        isActive: true,
        itemCount: loose.length,
        items: loose,
        translations: OTHER_GROUP.translations,
      });
    }

    const shown = visibleGroups.flatMap((g) => g.items);
    return {
      categories: visibleGroups,
      popular: shown.filter((i) => i.isPopular),
      itemCount: shown.length,
    };
  }

  /**
   * Recompute Restaurant.popularDishes + menuItemCount from the menu items the
   * public sees (items of hidden categories are left out).
   */
  static async syncRestaurant(restaurantId) {
    const visible = await this.visibleItemFilter({ restaurant: restaurantId });
    const [popular, count] = await Promise.all([
      MenuItem.find({ ...visible, isPopular: true })
        .sort(BY_ORDER)
        .limit(30)
        .lean(),
      MenuItem.countDocuments(visible),
    ]);
    await Restaurant.updateOne(
      { _id: restaurantId },
      {
        $set: {
          popularDishes: popular.map((i) => ({
            name: i.name,
            price: i.price ?? 0,
            image: i.image ?? null,
            item: i._id,
            translations: nameTranslations(i.translations),
          })),
          menuItemCount: count,
        },
      },
      { timestamps: false },
    );
  }

  /**
   * Re-derive MenuItem.searchKey / searchText and MenuCategory.searchKey
   * (bulk, no hooks / timestamps): only documents missing a key, or — `all`,
   * after a change of the key format — every document. Only changed keys are
   * written. → { items, categories } updated
   */
  static async refreshSearchKeys({ all = false } = {}) {
    const run = async (Model, filter, fields, keysOf) => {
      let updated = 0;
      let ops = [];
      const flush = async () => {
        if (ops.length) updated += (await Model.bulkWrite(ops, { ordered: false })).modifiedCount;
        ops = [];
      };
      for await (const doc of Model.find(filter, fields).lean().cursor()) {
        const keys = keysOf(doc);
        if (Object.entries(keys).every(([key, value]) => doc[key] === value)) continue;
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: keys }, timestamps: false } });
        if (ops.length >= KEY_BATCH) await flush();
      }
      await flush();
      return updated;
    };
    const items = await run(
      MenuItem,
      all ? {} : { $or: [{ searchText: { $exists: false } }, { searchKey: { $exists: false } }] },
      "name description translations searchKey searchText",
      menuItemSearchKeys,
    );
    const categories = await run(
      MenuCategory,
      all ? {} : { searchKey: { $exists: false } },
      "name translations searchKey",
      (doc) => ({ searchKey: menuCategorySearchKey(doc) }),
    );
    return { items, categories };
  }

  /** Next `order` at the end of a restaurant's categories / a category's items. */
  static async nextOrder(Model, filter) {
    const last = await Model.findOne(filter, "order").sort({ order: -1 }).lean();
    return (last?.order ?? -1) + 1;
  }

  /**
   * Boot migration: every restaurant not yet imported gets a MenuItem for each
   * legacy popular dish (skipping names it already has), then is marked.
   * → number of items created
   */
  static async importLegacyPopularDishes() {
    const pending = await Restaurant.find(
      { menuImportedAt: { $exists: false } },
      "popularDishes",
    ).lean();
    let created = 0;
    for (const restaurant of pending) {
      const existing = await MenuItem.find({ restaurant: restaurant._id }, "name").lean();
      const have = new Set(existing.map((i) => foldText(i.name)));
      let order = existing.length;
      const docs = [];
      (restaurant.popularDishes || []).forEach((dish) => {
        const key = foldText(dish?.name);
        if (!key || have.has(key)) return;
        have.add(key);
        docs.push({
          restaurant: restaurant._id,
          name: String(dish.name).trim().slice(0, 120),
          price: Number.isFinite(dish.price) && dish.price >= 0 ? dish.price : 0,
          image: dish.image || null,
          isPopular: true,
          isAvailable: true,
          order: order++,
          searchKey: key, // also derived by the insertMany hook; no translations yet
        });
      });
      if (docs.length) created += (await MenuItem.insertMany(docs)).length;
      await Restaurant.updateOne(
        { _id: restaurant._id },
        { $set: { menuImportedAt: new Date() } },
        { timestamps: false },
      );
      await this.syncRestaurant(restaurant._id);
    }
    return created;
  }

  /**
   * Validate a legacy popularDishes payload: [{ name, price, image }].
   * → { dishes } or { error }
   */
  static validateLegacyDishes(value) {
    if (!Array.isArray(value)) return { error: "popularDishes must be an array" };
    if (value.length > 30) return { error: "popularDishes can have at most 30 dishes" };
    const dishes = [];
    for (const raw of value) {
      if (!raw || typeof raw !== "object") return { error: "Each popular dish must be an object" };
      const name = String(raw.name ?? "").trim();
      if (!name) return { error: "Each popular dish needs a name" };
      const price = raw.price === undefined || raw.price === "" ? 0 : Number(raw.price);
      if (!Number.isFinite(price) || price < 0) return { error: `Invalid price for ${name}` };
      const image = raw.image ? String(raw.image) : null;
      dishes.push({ name: name.slice(0, 120), price, image });
    }
    return { dishes };
  }

  /**
   * Map the old admin form's popularDishes onto menu items: listed names become
   * popular (created when missing, price/image updated), other items stop
   * being popular. Nothing is deleted.
   */
  static async applyLegacyPopularDishes(restaurantId, dishes) {
    const items = await MenuItem.find({ restaurant: restaurantId });
    const byKey = new Map(items.map((i) => [foldText(i.name), i]));
    const listed = new Set();
    let order = await this.nextOrder(MenuItem, { restaurant: restaurantId });

    for (const dish of dishes) {
      const key = foldText(dish.name);
      if (listed.has(key)) continue;
      listed.add(key);
      const item = byKey.get(key);
      if (item) {
        item.set({ price: dish.price, image: dish.image, isPopular: true, isAvailable: true });
        await item.save();
      } else {
        await MenuItem.create({
          restaurant: restaurantId,
          name: dish.name,
          price: dish.price,
          image: dish.image,
          isPopular: true,
          order: order++,
        });
      }
    }
    const unlisted = items.filter((i) => i.isPopular && !listed.has(foldText(i.name)));
    if (unlisted.length) {
      await MenuItem.updateMany({ _id: { $in: unlisted.map((i) => i._id) } }, { $set: { isPopular: false } });
    }
    await this.syncRestaurant(restaurantId);
  }

  /** Is `path` a locally uploaded file we may delete? */
  static isDeletableUpload(path) {
    return (
      typeof path === "string" &&
      path.startsWith("uploads/") &&
      !path.includes("..") &&
      !path.startsWith(PROTECTED_DIR)
    );
  }

  /** Delete an uploaded image unless a restaurant or menu item still uses it. */
  static async deleteImageIfUnused(path) {
    if (!this.isDeletableUpload(path)) return false;
    const [item, restaurant] = await Promise.all([
      MenuItem.exists({ image: path }),
      Restaurant.exists({
        $or: [{ coverImages: path }, { menuPhotos: path }, { logo: path }, { "popularDishes.image": path }],
      }),
    ]);
    if (item || restaurant) return false;
    FileService.deleteFile(path);
    return true;
  }
}

export { MenuService };
