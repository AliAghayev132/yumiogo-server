import { Schema, Model } from "#constants";

/**
 * Counter — named auto-increment sequences for human-readable numbers
 * ("Review #4821", "Report #201" in the admin panel).
 */
const counterSchema = new Schema(
  {
    // Sequence name, e.g. "review" / "report".
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

/** Atomically take the next number of a sequence. */
counterSchema.statics.next = async function (name) {
  const doc = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return doc.seq;
};

/** Move a sequence forward to at least `value` (after a backfill). */
counterSchema.statics.bumpTo = function (name, value) {
  return this.updateOne({ _id: name }, { $max: { seq: value } }, { upsert: true });
};

export const Counter = Model("Counter", counterSchema);
