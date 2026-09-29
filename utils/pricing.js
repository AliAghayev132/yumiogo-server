/**
 * Price helpers (all amounts in ₼).
 *
 *  - priceLabel(): the green card price — "10 - 65₼" when a range is set,
 *    otherwise "32₼" (range bound or average price).
 *  - derivePriceLevel(): "$".."$$$$" from the average price using the admin
 *    bands of Settings.priceLevels (maxPrice = exclusive upper bound).
 */

const CURRENCY = "₼";

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const fmt = (value) => String(Math.round(value * 100) / 100);

/** { min, max, avg } of a restaurant (nulls when unknown). */
const priceRangeOf = ({ priceMin, priceMax, avgPrice } = {}) => ({
  min: num(priceMin),
  max: num(priceMax),
  avg: num(avgPrice),
});

const priceLabel = (restaurant) => {
  const { min, max, avg } = priceRangeOf(restaurant);
  if (min !== null && max !== null) {
    return min === max ? `${fmt(min)}${CURRENCY}` : `${fmt(min)} - ${fmt(max)}${CURRENCY}`;
  }
  const single = min ?? max ?? avg;
  return single === null ? "" : `${fmt(single)}${CURRENCY}`;
};

/**
 * Price level key for an average price, or null when the bands are not
 * configured (every maxPrice missing) so the stored level is kept.
 * `levels` = Settings.priceLevels in key order.
 */
const derivePriceLevel = (avgPrice, levels = []) => {
  const avg = num(avgPrice);
  if (avg === null || !levels.length) return null;
  if (!levels.some((l) => num(l.maxPrice) !== null)) return null;
  for (const level of levels) {
    const max = num(level.maxPrice);
    if (max === null || avg < max) return level.key;
  }
  return levels[levels.length - 1].key;
};

/** avgPrice range [lo, hi) of a price level key, from the same bands (null = open). */
const priceLevelBand = (key, levels = []) => {
  const index = levels.findIndex((l) => l.key === key);
  if (index < 0 || !levels.some((l) => num(l.maxPrice) !== null)) return null;
  return {
    min: index === 0 ? null : num(levels[index - 1].maxPrice),
    max: num(levels[index].maxPrice),
  };
};

export { CURRENCY, priceRangeOf, priceLabel, derivePriceLevel, priceLevelBand };
