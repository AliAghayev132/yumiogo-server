import { Schema, Model, userRoles, accountStatus } from "#constants";

const userSchema = new Schema(
  {
    // Personal info
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true, // creates a unique index implicitly
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    avatar: {
      type: String,
      default: null,
    },

    // Role & status
    role: {
      type: String,
      enum: userRoles,
      default: "user",
    },
    status: {
      type: String,
      enum: accountStatus,
      default: "active",
    },

    // ----- Social graph -----
    // Users this user follows (followers are derived via a reverse query).
    following: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    verified: {
      type: Boolean,
      default: false,
    },
    bio: {
      type: String,
      default: "",
    },
    // Onboarding "What food do you love?" preferences.
    preferences: {
      cuisines: { type: [String], default: [] },
      dietary: { type: [String], default: [] },
    },

    // Token version for "logout all devices"
    tokenVersion: {
      type: Number,
      default: 0,
    },

    // Last login timestamp
    lastLogin: {
      type: Date,
      default: null,
    },

    // Soft delete flag
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes (email is already indexed via unique: true)
userSchema.index({ status: 1 });
userSchema.index({ role: 1 });

export const User = Model("User", userSchema);
