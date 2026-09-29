import { Schema, Model, SEARCH_ENTRY_TYPES } from "#constants";

/**
 * SearchHistory — a signed-in user's recent searches ("Recent searches" on the
 * Search screen): a typed query or a picked restaurant / cuisine / mood /
 * dish / place. One row per (user, key); searching again moves it to the top.
 * Restaurant rows show the restaurant's current address.
 */
const searchHistorySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: { type: String, enum: SEARCH_ENTRY_TYPES, required: true },
    // What the row shows ("Caspian Grill", "Italian", "noodle").
    label: { type: String, required: true, trim: true, maxlength: 120 },
    // Text to search again (defaults to the label).
    query: { type: String, default: "", trim: true, maxlength: 120 },
    // Second line for non-restaurant rows ("Cuisine", "Sulh Street, Sumqayit").
    subtitle: { type: String, default: "", trim: true, maxlength: 160 },
    restaurant: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null },
    // Place rows: [lng, lat].
    coordinates: { type: [Number], default: undefined },
    // De-duplication key: "<type>:<restaurant id | folded label>".
    key: { type: String, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

searchHistorySchema.index({ user: 1, key: 1 }, { unique: true });
searchHistorySchema.index({ user: 1, updatedAt: -1 });

export const SearchHistory = Model("SearchHistory", searchHistorySchema);
