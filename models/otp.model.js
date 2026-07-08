import { crypto, mongoose } from "#lib";
import { Schema, Model, otpTypes } from "#constants";

const otpSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: otpTypes,
      default: "register",
    },
    // Arbitrary payload carried between OTP steps (e.g. hashed password on register)
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // TTL index: document auto-deletes once expiresAt passes
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
    attempts: {
      type: Number,
      default: 0,
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Generate a 6-digit OTP code
otpSchema.statics.generateCode = function () {
  return crypto.randomInt(100000, 999999).toString();
};

// Create an OTP with a 10 minute expiry (replaces any existing one of same type)
otpSchema.statics.createOTP = async function (email, type, data = {}) {
  await this.deleteMany({ email: email.toLowerCase(), type });

  const code = this.generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  return this.create({
    email: email.toLowerCase(),
    code,
    type,
    data,
    expiresAt,
  });
};

// Verify an OTP code
otpSchema.statics.verifyOTP = async function (email, code, type) {
  const otp = await this.findOne({
    email: email.toLowerCase(),
    type,
    verified: false,
  });

  if (!otp) {
    return { valid: false, error: "OTP not found or expired" };
  }

  if (otp.attempts >= 5) {
    await otp.deleteOne();
    return { valid: false, error: "Too many invalid attempts. Request a new code" };
  }

  if (otp.code !== code) {
    otp.attempts += 1;
    await otp.save();
    return { valid: false, error: "Invalid OTP code" };
  }

  if (otp.expiresAt < new Date()) {
    await otp.deleteOne();
    return { valid: false, error: "OTP code has expired" };
  }

  otp.verified = true;
  await otp.save();

  return { valid: true, data: otp.data };
};

export const OTP = Model("OTP", otpSchema);
