import { Schema, Model, postStatus } from "#constants";
// Imported directly (not via the #services barrel) to avoid a models <-> services
// circular import through BootstrapService.
import { EncryptionService } from "#services/EncryptionService.js";

/**
 * Post model — the reference/example model for this template.
 *
 * It intentionally demonstrates every Mongoose convention used across the
 * codebase so you can copy it when adding a new resource:
 *   - a compound index
 *   - a virtual (`url`)
 *   - a static method (`findPublished`)
 *   - an instance method (`incrementViews`)
 *   - a pre-save hook (auto-generate `slug` from `title`)
 *   - toJSON / toObject with { virtuals: true }
 */
const postSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    // Unique URL-safe identifier, auto-generated from title if not provided
    slug: {
      type: String,
      unique: true,
    },
    content: {
      type: String,
      required: true,
    },
    excerpt: {
      type: String,
    },
    // Reference to the owning user
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: postStatus,
      default: "draft",
    },
    tags: {
      type: [String],
      default: [],
    },
    views: {
      type: Number,
      default: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    // Include virtuals when serializing to JSON / plain objects
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ----- Compound index -----
// Speeds up the common "published posts, newest first" query.
postSchema.index({ status: 1, createdAt: -1 });

// ----- Virtual -----
// Derived, non-persisted field: the public URL of the post.
postSchema.virtual("url").get(function () {
  return `/posts/${this.slug}`;
});

// ----- Pre-save hook -----
// Auto-generate a slug from the title when missing (or when title changes and
// no explicit slug was set). A short random suffix keeps slugs unique.
postSchema.pre("save", function () {
  if (!this.slug && this.title) {
    const base = EncryptionService.generateSlug(this.title);
    const suffix = Math.random().toString(36).slice(2, 7);
    this.slug = `${base}-${suffix}`;
  }
});

// ----- Static method -----
// Fetch published, non-deleted posts (newest first).
postSchema.statics.findPublished = function (filter = {}) {
  return this.find({ ...filter, status: "published", isDeleted: false }).sort({
    createdAt: -1,
  });
};

// ----- Instance method -----
// Atomically increment the view counter and persist it.
postSchema.methods.incrementViews = async function () {
  this.views += 1;
  await this.save();
  return this.views;
};

export const Post = Model("Post", postSchema);
