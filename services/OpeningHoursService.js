import { Restaurant, Settings } from "#models";
import { computeOpenNow, setTimezone, getTimezone } from "#utils";

/**
 * OpeningHoursService — keeps the derived Restaurant.openNow flag in step with
 * the clock. The pre-save hook covers edits; this refreshes every restaurant at
 * boot and then every few minutes, so "Open now" filters stay correct as
 * opening/closing times pass. The same tick ends promotions whose
 * discountEndsAt has passed. An "Open now" search first calls ensureFresh(),
 * which re-runs the refresh when the last one is older than a minute.
 */

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FRESH_MS = 60 * 1000; // max age of the flags for an "Open now" filter

class OpeningHoursService {
  static timer = null;
  static lastRefreshAt = 0;
  static running = null;

  /** Load Settings.timezone into the cache used by the pre-save hook. */
  static async loadTimezone() {
    const settings = await Settings.findOne({ key: "app" }).select("timezone").lean();
    setTimezone(settings?.timezone);
    return getTimezone();
  }

  /** Recompute openNow for every restaurant; writes only the changed ones. */
  static refreshAll() {
    const pass = this.runRefresh().finally(() => {
      if (this.running === pass) this.running = null;
    });
    this.running = pass;
    return pass;
  }

  /**
   * refreshAll() when the last pass is older than `maxAgeMs` (else a no-op);
   * joins a pass that is already running.
   */
  static async ensureFresh(maxAgeMs = FRESH_MS) {
    if (Date.now() - this.lastRefreshAt < maxAgeMs) return 0;
    return this.running || this.refreshAll();
  }

  static async runRefresh() {
    await this.loadTimezone();
    const startedAt = Date.now();

    const restaurants = await Restaurant.find(
      { isDeleted: false },
      "hours temporarilyClosed openNow updatedAt",
    ).lean();

    const now = new Date();
    const ops = [];
    restaurants.forEach((r) => {
      const openNow = computeOpenNow(r, now);
      if (openNow !== r.openNow) {
        ops.push({
          updateOne: {
            // Only if nobody saved the restaurant since it was read (an admin
            // edit recomputes openNow itself and must not be overwritten).
            filter: { _id: r._id, openNow: r.openNow ?? null, updatedAt: r.updatedAt ?? null },
            update: { $set: { openNow } },
            timestamps: false, // a clock tick is not an edit
          },
        });
      }
    });

    if (ops.length) await Restaurant.bulkWrite(ops, { ordered: false });

    // Promotions whose end date passed are switched off.
    await Restaurant.updateMany(
      { discountPercent: { $gt: 0 }, discountEndsAt: { $ne: null, $lte: now } },
      { $set: { discountPercent: 0, discountEndsAt: null } },
      { timestamps: false },
    );
    this.lastRefreshAt = startedAt;
    return ops.length;
  }

  /** Run once now and then on an unref'd interval (never keeps the process alive). */
  static start() {
    if (this.timer) return;

    const run = () =>
      this.refreshAll().catch((error) =>
        console.error("❌ Opening hours refresh failed:", error.message),
      );

    run();
    this.timer = setInterval(run, REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  static stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export { OpeningHoursService };
