import { crypto } from "#lib";
import { Schema, Model, userRoles, accountStatus, APP_LANGUAGES } from "#constants";

// Languages the app can be switched to (Profile → Language).
export const USER_LANGUAGES = APP_LANGUAGES;

// Who can see my reviews / favourite lists (Settings → Activity visibility).
export const VISIBILITY_OPTIONS = ["everyone", "followers", "me"];

// How the account signs in.
export const AUTH_PROVIDERS = ["local", "google"];

/**
 * Normalised contact values used for contact matching. Hashing them lets the
 * app send SHA-256 hashes instead of raw address-book entries.
 */
export const hashContact = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

// A warning issued from the admin Users page ("Issue a warning").
const warningSchema = new Schema(
  {
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const userSchema = new Schema(
  {
    // Personal info
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true, // creates a unique index implicitly
      lowercase: true,
      trim: true,
    },
    // Optional for Google-only accounts (they can set one via change-password).
    password: {
      type: String,
      default: null,
    },
    // E.164, e.g. "+994501234567".
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    avatar: {
      type: String,
      default: null,
    },
    // City name from the admin City catalog ("Baku").
    city: {
      type: String,
      default: "",
      trim: true,
    },
    // "Private" chip: reviews/lists are only shown to followers, and the
    // account is left out of people suggestions.
    isPrivate: {
      type: Boolean,
      default: false,
    },
    language: {
      type: String,
      enum: USER_LANGUAGES,
      default: "en",
    },

    // ----- Sign-in providers -----
    authProvider: {
      type: String,
      enum: AUTH_PROVIDERS,
      default: "local",
    },
    googleId: {
      type: String,
      default: undefined,
    },

    // Privacy-policy / terms consent captured at sign-up.
    terms: {
      version: { type: String, default: null },
      acceptedAt: { type: Date, default: null },
      method: { type: String, default: null }, // "register" | "google"
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
    // People the user dismissed from "Suggested people".
    dismissedSuggestions: {
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
      trim: true,
      maxlength: 160,
    },
    // Onboarding "What food do you love?" preferences (catalog names).
    preferences: {
      cuisines: { type: [String], default: [] },
      dietary: { type: [String], default: [] },
    },

    // ----- Invites ("Invite friends 0/3", "Refer a friend") -----
    inviteCode: {
      type: String,
      default: undefined,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    invitesSent: {
      type: Number,
      default: 0,
    },

    // Contact matching hashes (sha256 of the normalised email / E.164 phone).
    emailHash: { type: String, default: undefined },
    phoneHash: { type: String, default: undefined },

    // Expo push tokens of the user's devices.
    pushTokens: {
      type: [String],
      default: [],
    },

    // Per-user app settings (notifications + activity visibility).
    settings: {
      emailNotifications: { type: Boolean, default: true },
      pushNotifications: { type: Boolean, default: true },
      followerAlerts: { type: Boolean, default: true },
      reservationAlerts: { type: Boolean, default: true },
      // who can see my reviews / my favourite lists
      reviewsVisibility: {
        type: String,
        enum: VISIBILITY_OPTIONS,
        default: "everyone",
      },
      listsVisibility: {
        type: String,
        enum: VISIBILITY_OPTIONS,
        default: "everyone",
      },
    },

    // Token version for "logout all devices"
    tokenVersion: {
      type: Number,
      default: 0,
    },

    // Refresh-token families (one per signed-in device / session). Each refresh
    // rotates `jti`; presenting an older token of the family (reuse) revokes
    // every session. Never selected by default. See AuthTokenService.
    refreshSessions: {
      type: [
        new Schema(
          {
            family: { type: String, required: true },
            jti: { type: String, required: true },
            // The token rotated away last (accepted for a few seconds so
            // parallel refreshes of one client don't count as reuse).
            prevJti: { type: String, default: null },
            // Hash of the pre-rotation (legacy, jti-less) token this family replaced.
            legacyJti: { type: String, default: null },
            rememberMe: { type: Boolean, default: false },
            // tokenVersion the family was opened with (stale once it changes).
            version: { type: Number, default: 0 },
            rotatedAt: { type: Date, default: Date.now },
            expiresAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
      select: false,
    },

    // Last login timestamp
    lastLogin: {
      type: Date,
      default: null,
    },

    // Soft delete flag (personal data is anonymised by AccountService)
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: String,
      default: null, // "self" | "admin"
    },

    // ----- Admin moderation (Users page: Warn / Ban / Restore) -----
    // Why the account is suspended / banned (shown to the user and admins).
    statusReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    // End of a temporary suspension; null = until an admin restores it.
    suspendedUntil: {
      type: Date,
      default: null,
    },
    statusChangedAt: {
      type: Date,
      default: null,
    },
    statusChangedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    warnings: {
      type: [warningSchema],
      default: [],
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
userSchema.index({ following: 1 });
userSchema.index({ invitedBy: 1 });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ inviteCode: 1 }, { unique: true, sparse: true });
userSchema.index({ emailHash: 1 }, { sparse: true });
userSchema.index({ phoneHash: 1 }, { sparse: true });

// Keep the contact-matching hashes in step with email / phone.
userSchema.pre("save", function () {
  if (this.isDeleted) return;
  if (this.isModified("email") || !this.emailHash) {
    this.emailHash = this.email ? hashContact(this.email.toLowerCase()) : undefined;
  }
  if (this.isModified("phone") || (this.phone && !this.phoneHash)) {
    this.phoneHash = this.phone ? hashContact(this.phone) : undefined;
  }
});

/** True when the account can sign in with a password. */
userSchema.methods.hasPassword = function () {
  return typeof this.password === "string" && this.password.length > 0;
};

export const User = Model("User", userSchema);
