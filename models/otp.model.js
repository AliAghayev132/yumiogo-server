import { crypto, mongoose } from "#lib";
import { config } from "#config";
import { Schema, Model, otpTypes } from "#constants";

/**
 * OTP — one pending e-mail verification code per (email, type).
 *
 * - Codes are 4 digits (Figma shows 4 boxes) and stored only as an HMAC.
 * - Wrong guesses are counted atomically per code (MAX_ATTEMPTS) and per
 *   window (MAX_FAILURES), so neither parallel guessing nor asking for a new
 *   code resets the brute-force budget.
 * - Sending is throttled per address: RESEND_COOLDOWN between sends and at
 *   most MAX_SENDS per window (also stops e-mail bombing).
 * The document lives for the whole window (TTL on `expiresAt`); the code
 * itself is valid until `codeExpiresAt`.
 */
export const OTP_POLICY = {
  CODE_LENGTH: 4,
  CODE_TTL: config.otpExpiresIn || 600, // seconds a code stays valid
  RESEND_COOLDOWN: 60, // seconds between two sends
  MAX_ATTEMPTS: 5, // wrong guesses per code
  MAX_SENDS: 8, // codes per window
  MAX_FAILURES: 10, // wrong guesses per window
  WINDOW: 24 * 60 * 60, // seconds
};

const otpSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    type: {
      type: String,
      enum: otpTypes,
      default: "register",
    },
    codeHash: {
      type: String,
      required: true,
    },
    codeExpiresAt: {
      type: Date,
      required: true,
    },
    // Arbitrary payload carried between OTP steps (e.g. hashed password on register)
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Wrong guesses for the current code.
    attempts: {
      type: Number,
      default: 0,
    },
    // Wrong guesses / sends in the current window.
    failures: {
      type: Number,
      default: 0,
    },
    sendCount: {
      type: Number,
      default: 0,
    },
    windowStartedAt: {
      type: Date,
      default: Date.now,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    // TTL index: document auto-deletes once the window is over.
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: true,
  },
);

otpSchema.index({ email: 1, type: 1 }, { unique: true });

const secondsUntil = (date, now = Date.now()) =>
  Math.max(1, Math.ceil((new Date(date).getTime() - now) / 1000));

const hashCode = (email, type, code) =>
  crypto
    .createHmac("sha256", config.encryptionKey)
    .update(`${email}:${type}:${code}`)
    .digest("hex");

const sameHash = (a, b) => {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// Random numeric code with leading zeros kept ("0427").
otpSchema.statics.generateCode = function () {
  const { CODE_LENGTH } = OTP_POLICY;
  return crypto.randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, "0");
};

/** Public numbers the app needs to render the code boxes and the resend timer. */
otpSchema.statics.meta = function (otp) {
  const now = Date.now();
  return {
    codeLength: OTP_POLICY.CODE_LENGTH,
    expiresIn: otp ? secondsUntil(otp.codeExpiresAt, now) : OTP_POLICY.CODE_TTL,
    resendIn: otp
      ? Math.max(0, OTP_POLICY.RESEND_COOLDOWN - Math.floor((now - otp.lastSentAt.getTime()) / 1000))
      : 0,
    attemptsLeft: otp ? Math.max(0, OTP_POLICY.MAX_ATTEMPTS - otp.attempts) : OTP_POLICY.MAX_ATTEMPTS,
  };
};

/** Pending OTP for (email, type) whose window is still open, or null. */
otpSchema.statics.findPending = async function (email, type) {
  const otp = await this.findOne({ email: String(email).toLowerCase(), type });
  if (!otp || otp.expiresAt <= new Date()) return null;
  return otp;
};

/**
 * Issue (or re-issue) a code, enforcing the send limits.
 * → { otp, code } | { error, errorCode, status, retryAfter }
 */
otpSchema.statics.issue = async function (email, type, data = {}) {
  const now = new Date();
  const address = String(email).toLowerCase();
  const code = this.generateCode();
  const codeExpiresAt = new Date(now.getTime() + OTP_POLICY.CODE_TTL * 1000);
  const fresh = {
    codeHash: hashCode(address, type, code),
    codeExpiresAt,
    attempts: 0,
    verified: false,
    data,
    lastSentAt: now,
  };

  let otp = await this.findOne({ email: address, type });
  // Expired window, or a legacy plaintext-code document.
  if (otp && (otp.expiresAt <= now || !otp.codeHash)) {
    await otp.deleteOne();
    otp = null;
  }

  if (!otp) {
    try {
      const created = await this.create({
        email: address,
        type,
        ...fresh,
        sendCount: 1,
        failures: 0,
        windowStartedAt: now,
        expiresAt: new Date(now.getTime() + OTP_POLICY.WINDOW * 1000),
      });
      return { otp: created, code };
    } catch (error) {
      if (error.code !== 11000) throw error;
      // A parallel request created it first.
      return {
        error: "Please wait before requesting another code",
        errorCode: "OTP_COOLDOWN",
        status: 429,
        retryAfter: OTP_POLICY.RESEND_COOLDOWN,
      };
    }
  }

  const windowEnd = otp.expiresAt;
  if (otp.failures >= OTP_POLICY.MAX_FAILURES) {
    return {
      error: "Too many invalid codes. Please try again later",
      errorCode: "OTP_LOCKED",
      status: 429,
      retryAfter: secondsUntil(windowEnd),
    };
  }
  const cooldownEnd = otp.lastSentAt.getTime() + OTP_POLICY.RESEND_COOLDOWN * 1000;
  if (cooldownEnd > now.getTime()) {
    return {
      error: "Please wait before requesting another code",
      errorCode: "OTP_COOLDOWN",
      status: 429,
      retryAfter: secondsUntil(cooldownEnd),
    };
  }
  if (otp.sendCount >= OTP_POLICY.MAX_SENDS) {
    return {
      error: "Too many codes requested. Please try again later",
      errorCode: "OTP_SEND_LIMIT",
      status: 429,
      retryAfter: secondsUntil(windowEnd),
    };
  }

  // Conditional on lastSentAt so two parallel resends can't both pass.
  const updated = await this.findOneAndUpdate(
    { _id: otp._id, lastSentAt: otp.lastSentAt },
    {
      $set: {
        ...fresh,
        expiresAt: new Date(Math.max(windowEnd.getTime(), codeExpiresAt.getTime())),
      },
      $inc: { sendCount: 1 },
    },
    { returnDocument: "after" },
  );
  if (!updated) {
    return {
      error: "Please wait before requesting another code",
      errorCode: "OTP_COOLDOWN",
      status: 429,
      retryAfter: OTP_POLICY.RESEND_COOLDOWN,
    };
  }
  return { otp: updated, code };
};

/** Withdraw the last send (mail delivery failed) so the user can retry at once. */
otpSchema.statics.rollbackSend = async function (otp) {
  if (!otp) return;
  if (otp.sendCount <= 1) {
    await this.deleteOne({ _id: otp._id });
    return;
  }
  await this.updateOne(
    { _id: otp._id },
    { $set: { lastSentAt: new Date(0) }, $inc: { sendCount: -1 } },
  );
};

/**
 * Check a code. Attempts are counted atomically before comparing.
 * → { valid: true, data } | { valid: false, error, errorCode, attemptsLeft? }
 */
otpSchema.statics.verifyCode = async function (email, code, type) {
  const now = new Date();
  const address = String(email).toLowerCase();
  const input = String(code ?? "").trim();

  const otp = await this.findOneAndUpdate(
    {
      email: address,
      type,
      verified: false,
      codeExpiresAt: { $gt: now },
      attempts: { $lt: OTP_POLICY.MAX_ATTEMPTS },
      failures: { $lt: OTP_POLICY.MAX_FAILURES },
    },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );

  if (!otp) {
    const current = await this.findOne({ email: address, type });
    if (!current || current.expiresAt <= now || current.verified) {
      return { valid: false, error: "Code not found or expired. Request a new code", errorCode: "OTP_NOT_FOUND" };
    }
    if (current.failures >= OTP_POLICY.MAX_FAILURES) {
      return { valid: false, error: "Too many invalid codes. Please try again later", errorCode: "OTP_LOCKED" };
    }
    if (current.codeExpiresAt <= now) {
      return { valid: false, error: "The code has expired. Request a new code", errorCode: "OTP_EXPIRED" };
    }
    return {
      valid: false,
      error: "Too many invalid attempts. Request a new code",
      errorCode: "OTP_TOO_MANY_ATTEMPTS",
      attemptsLeft: 0,
    };
  }

  if (!/^\d+$/.test(input) || !sameHash(hashCode(address, type, input), otp.codeHash)) {
    await this.updateOne({ _id: otp._id }, { $inc: { failures: 1 } });
    return {
      valid: false,
      error: "Invalid verification code",
      errorCode: "OTP_INVALID",
      attemptsLeft: Math.max(0, OTP_POLICY.MAX_ATTEMPTS - otp.attempts),
    };
  }

  // Single use: only one parallel request can flip verified.
  const claimed = await this.findOneAndUpdate(
    { _id: otp._id, verified: false },
    { $set: { verified: true } },
    { returnDocument: "after" },
  );
  if (!claimed) {
    return { valid: false, error: "Code not found or expired. Request a new code", errorCode: "OTP_NOT_FOUND" };
  }
  return { valid: true, data: claimed.data || {} };
};

// Backwards-compatible alias (old signature: email, code, type).
otpSchema.statics.verifyOTP = function (email, code, type) {
  return this.verifyCode(email, code, type);
};

export const OTP = Model("OTP", otpSchema);
