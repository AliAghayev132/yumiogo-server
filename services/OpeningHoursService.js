import { Restaurant, Settings } from "#models";
import { computeOpenNow, setTimezone, getTimezone } from "#utils";

/**
 * OpeningHoursService — keeps the derived Restaurant.openNow flag in step with
 * the clock. The pre-save hook covers edits; this refreshes every restaurant at
 * boot and then every few minutes, so "Open now" filters stay correct as
 * opening/closing times pass. The same tick ends promotions whose
 * discountEndsAt has passed.
 */

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class OpeningHoursService {
  static timer = null;

  /** Load Settings.timezone into the cache used by the pre-save hook. */
  static async loadTimezone() {
    const settings = await Settings.findOne({ key: "app" }).select("timezone").lean();
    setTimezone(settings?.timezone);
    return getTimezone();
  }

  /** Recompute openNow for every restaurant; writes only the changed ones. */
  static async refreshAll() {
    await this.loadTimezone();

    const restaurants = await Restaurant.find(
      { isDeleted: false },
      "hours temporarilyClosed openNow",
    ).lean();

    const now = new Date();
    const ops = [];
    restaurants.forEach((r) => {
      const openNow = computeOpenNow(r, now);
      if (openNow !== r.openNow) {
        ops.push({
          updateOne: {
            filter: { _id: r._id },
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
