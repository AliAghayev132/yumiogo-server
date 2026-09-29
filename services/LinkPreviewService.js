import { fs } from "#lib";
import { config } from "#config";
import { Restaurant, FavoriteList, Review, User } from "#models";
import { priceLabel } from "#utils/pricing.js";
import { AccountService } from "./AccountService.js";

/**
 * LinkPreviewService — Open Graph / Twitter meta tags for the share links.
 *
 * WhatsApp, iMessage, Telegram, Facebook … fetch a shared URL and read its
 * <head> without running JavaScript, so the SPA's index.html alone always
 * previews as "Yumio Admin". For the public landing routes
 *   /restaurant/:idOrSlug   /list/:slug   /invite/:code   /review/:id
 * the server's SPA fallback injects title, description, image and url built
 * from PUBLIC data only (the same data the guest API returns):
 *   - restaurant: active, not in Trash — name, cuisines, address, rating, cover;
 *   - list: public / collaborative (private = none), owner active — name,
 *     restaurant count and names, first cover;
 *   - invite: an active inviter — first name only;
 *   - review: approved, author active, restaurant public — restaurant name and
 *     cover only (review text / author stay in the app, reviews need sign-in).
 * Everything is HTML-escaped. Unknown / hidden targets fall back to the plain
 * index.html. Restaurant pages become indexable; list / invite / review
 * previews stay noindex, and every other path (the admin panel) is served
 * untouched (noindex, nofollow). Results are cached for a minute.
 */

const SITE_NAME = "Yumio";
const DEFAULT_IMAGE = "uploads/catalog/defaults/brand/og-default.png";
const DEFAULT_DESCRIPTION =
  "Discover the best places to eat around you, save your favourites and see where your friends go.";
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 500;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const ROUTES = [
  { rx: /^\/restaurant\/([^/?#]{1,200})\/?$/, kind: "restaurant" },
  { rx: /^\/list\/([^/?#]{1,120})\/?$/, kind: "list" },
  { rx: /^\/invite\/([^/?#]{1,32})\/?$/, kind: "invite" },
  { rx: /^\/review\/([^/?#]{1,40})\/?$/, kind: "review" },
];

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// One line, at most `max` characters (word boundary, "…").
const clip = (text, max = 200) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
};

// "Street 5, Baku" — the city only when the address doesn't already name it.
const placeOf = (r) => {
  const address = String(r?.address || "").trim();
  const city = String(r?.city || "").trim();
  if (!city || address.toLowerCase().includes(city.toLowerCase())) return address;
  return [address, city].filter(Boolean).join(", ");
};

const isLive = (user) => !!user && !user.isDeleted && user.status === "active";
const PUBLIC_RESTAURANT = { isDeleted: false, status: "active" };

class LinkPreviewService {
  static cache = new Map();
  static indexCache = { file: null, mtimeMs: 0, html: "" };

  /** Absolute URL for a stored image ("uploads/…" or http(s)://…). */
  static imageUrl(value, origin) {
    const path = typeof value === "string" ? value.trim() : "";
    if (/^https?:\/\//i.test(path)) return path;
    const stored = path && /^\/?uploads\//.test(path) ? path.replace(/^\//, "") : DEFAULT_IMAGE;
    return `${origin}/${stored}`;
  }

  // ------------------------------------------------------------ lookups

  static async restaurant(idOrSlug) {
    const key = decodeURIComponent(idOrSlug);
    const filter = { ...(OBJECT_ID.test(key) ? { _id: key } : { slug: key }), ...PUBLIC_RESTAURANT };
    const r = await Restaurant.findOne(
      filter,
      "name slug description cuisines address city coverImages rating reviewCount avgPrice priceMin priceMax",
    ).lean();
    if (!r) return null;
    const rating = r.reviewCount > 0 ? `★ ${Number(r.rating || 0).toFixed(1)} (${r.reviewCount})` : "";
    const facts = [(r.cuisines || []).slice(0, 3).join(", "), priceLabel(r), placeOf(r)]
      .filter(Boolean)
      .join(" · ");
    return {
      title: `${r.name} — ${SITE_NAME}`,
      description: clip([rating, facts, r.description].filter(Boolean).join(" · ")),
      image: r.coverImages?.[0] || null,
      imageAlt: r.name,
      indexable: true,
    };
  }

  static async list(slug) {
    const list = await FavoriteList.findOne({ shareSlug: decodeURIComponent(slug), isDeleted: false })
      .select("name privacy owner items")
      .populate("owner", "isDeleted status")
      .populate({ path: "items.restaurant", match: PUBLIC_RESTAURANT, select: "name coverImages" })
      .lean();
    // Private lists (and lists of removed accounts) preview like missing ones.
    if (!list || list.privacy === "private" || !isLive(list.owner)) return null;
    const restaurants = (list.items || []).map((item) => item.restaurant).filter(Boolean);
    const count = restaurants.length;
    const names = restaurants.slice(0, 3).map((r) => r.name);
    const more = count > names.length ? `, +${count - names.length}` : "";
    return {
      title: `${list.name} — ${SITE_NAME}`,
      description: clip(
        count
          ? `${count} ${count === 1 ? "restaurant" : "restaurants"}: ${names.join(", ")}${more}. A list on ${SITE_NAME}.`
          : `A list on ${SITE_NAME}.`,
      ),
      image: restaurants.find((r) => r.coverImages?.length)?.coverImages[0] || null,
      imageAlt: list.name,
      indexable: false,
    };
  }

  static async invite(code) {
    const inviter = await AccountService.findInviter(decodeURIComponent(code));
    if (!inviter) return null;
    return {
      title: `${inviter.firstName} invited you to ${SITE_NAME}`,
      description: DEFAULT_DESCRIPTION,
      image: null,
      imageAlt: SITE_NAME,
      indexable: false,
    };
  }

  static async review(id) {
    if (!OBJECT_ID.test(id)) return null;
    const review = await Review.findOne({ _id: id, isDeleted: false, status: "approved" }, "user restaurant")
      .populate({ path: "restaurant", match: PUBLIC_RESTAURANT, select: "name coverImages address city" })
      .lean();
    if (!review?.restaurant) return null;
    const author = await User.findById(review.user, "isDeleted status").lean();
    if (!isLive(author)) return null;
    const r = review.restaurant;
    return {
      title: `A review of ${r.name} — ${SITE_NAME}`,
      description: clip([placeOf(r), `Read it in the ${SITE_NAME} app.`].filter(Boolean).join(" · ")),
      image: r.coverImages?.[0] || null,
      imageAlt: r.name,
      indexable: false,
    };
  }

  /** Preview data for a landing path, or null (cached briefly, misses too). */
  static async metaFor(pathname) {
    const route = ROUTES.find((r) => r.rx.test(pathname));
    if (!route) return null;
    const now = Date.now();
    const hit = this.cache.get(pathname);
    if (hit && hit.expires > now) return hit.meta;

    const [, param] = pathname.match(route.rx);
    let meta = null;
    try {
      meta = await this[route.kind](param);
    } catch (_error) {
      meta = null; // malformed slug / id → plain page
    }
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(pathname, { meta, expires: now + CACHE_TTL_MS });
    return meta;
  }

  // -------------------------------------------------------------- HTML

  /** index.html, re-read only when the build changes. */
  static async indexHtml(indexFile) {
    const { mtimeMs } = await fs.promises.stat(indexFile);
    const cached = this.indexCache;
    if (cached.file !== indexFile || cached.mtimeMs !== mtimeMs) {
      this.indexCache = { file: indexFile, mtimeMs, html: await fs.promises.readFile(indexFile, "utf8") };
    }
    return this.indexCache.html;
  }

  /** The <head> tags for `meta` at `url`. */
  static tags(meta, url, origin) {
    const image = this.imageUrl(meta.image, origin);
    const e = escapeHtml;
    return [
      `<title>${e(meta.title)}</title>`,
      `<meta name="description" content="${e(meta.description)}" />`,
      `<meta name="robots" content="${meta.indexable ? "index, follow" : "noindex, follow"}" />`,
      `<link rel="canonical" href="${e(url)}" />`,
      `<meta property="og:site_name" content="${SITE_NAME}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${e(meta.title)}" />`,
      `<meta property="og:description" content="${e(meta.description)}" />`,
      `<meta property="og:url" content="${e(url)}" />`,
      `<meta property="og:image" content="${e(image)}" />`,
      `<meta property="og:image:alt" content="${e(meta.imageAlt || meta.title)}" />`,
      `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
      `<meta name="twitter:title" content="${e(meta.title)}" />`,
      `<meta name="twitter:description" content="${e(meta.description)}" />`,
      `<meta name="twitter:image" content="${e(image)}" />`,
    ].join("\n    ");
  }

  /**
   * index.html with the preview tags for `req`, or null when the path is not
   * a public landing route (or its target is not public) → serve the file.
   */
  static async render(req, indexFile) {
    if (!ROUTES.some((r) => r.rx.test(req.path))) return null;
    const meta = await this.metaFor(req.path);
    if (!meta) return null;

    // Production: the public web origin (share links are built on it too);
    // elsewhere the host the request came to.
    const origin =
      process.env.NODE_ENV === "production" && config.webUrl ? config.webUrl : `${req.protocol}://${req.get("host")}`;
    const url = `${origin}${req.path}`;
    const html = await this.indexHtml(indexFile);
    const stripped = html
      .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
      .replace(/<meta\s+name=["'](?:description|robots)["'][^>]*>\s*/gi, "");
    // Before </head>: <meta charset> must stay within the first 1024 bytes.
    return stripped.replace(/<\/head>/i, `  ${this.tags(meta, url, origin)}\n  </head>`);
  }

  /** Forget cached previews (tests / after bulk edits). */
  static clear() {
    this.cache.clear();
  }
}

export { LinkPreviewService };
