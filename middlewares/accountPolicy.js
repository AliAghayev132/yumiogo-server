import { config } from "#config";
import { User } from "#models";
import { HashService, PlatformService, ModerationService } from "#services";

/**
 * Platform policies applied around routes owned by other modules, so the admin
 * Settings toggles are enforced whatever controller handles the request:
 *
 *  - accountStatusGate      POST /api/auth/login — clear 403s for pending /
 *                           suspended / banned accounts (after the password
 *                           check) and auto-lifting of ended suspensions.
 *  - newAccountPolicy       POST /api/auth/* — a 201 that created an account:
 *                           "New user approval" → the account becomes pending,
 *                           its tokens are revoked and the reply says so;
 *                           "Default language" → set when none was chosen;
 *                           "New user alerts" → admins are notified.
 *  - restaurantApprovalGate POST /api/restaurants — "Restaurant approval" →
 *                           new restaurants start as pending.
 */

const STATUS_REPLIES = {
  pending: () => ({
    code: "ACCOUNT_PENDING",
    message: "Your account is awaiting approval. We'll let you know as soon as an admin approves it.",
  }),
  suspended: (user) => ({
    code: "ACCOUNT_SUSPENDED",
    message: user.suspendedUntil
      ? `Your account is suspended until ${new Date(user.suspendedUntil).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}.`
      : "Your account is suspended.",
  }),
  banned: () => ({
    code: "ACCOUNT_BANNED",
    message: "Your account has been banned.",
  }),
};

/**
 * Hook into res.json once: `handler(body)` may return a replacement body
 * (sync or async). Errors in the handler never break the response.
 */
const onJson = (res, handler) => {
  const original = res.json.bind(res);
  res.json = (body) => {
    res.json = original;
    Promise.resolve()
      .then(() => handler(body))
      .then((replacement) => original(replacement === undefined ? body : replacement))
      .catch((error) => {
        console.error("Response policy error:", error.message);
        original(body);
      });
    return res;
  };
};

// ----------------------------------------------------------------- login

const accountStatusGate = async (req, res, next) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) return next();

    const user = await User.findOne({ email, isDeleted: false }).select(
      "password status statusReason suspendedUntil",
    );
    if (!user || user.status === "active") return next();

    // A suspension that has run out is lifted here, then the login proceeds.
    if (user.status === "suspended" && user.suspendedUntil && user.suspendedUntil <= new Date()) {
      await ModerationService.liftSuspension(user._id);
      return next();
    }

    // Only reveal the account state to someone who knows the password.
    const reply = STATUS_REPLIES[user.status];
    if (!reply || !user.password || !(await HashService.comparePassword(password, user.password))) {
      return next();
    }

    const { code, message } = reply(user);
    return res.status(403).json({
      success: false,
      code,
      message,
      data: {
        status: user.status,
        reason: user.statusReason || "",
        until: user.suspendedUntil || null,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// ----------------------------------------------------------- new accounts

const newAccountPolicy = (req, res, next) => {
  if (req.method !== "POST") return next();
  onJson(res, async (body) => {
    const user = body?.data?.user;
    const userId = user?.id || user?._id;
    if (res.statusCode !== 201 || !body?.success || !userId || !body.data.tokens) return undefined;

    const settings = await PlatformService.settings();
    const set = {};
    // "Default language" applies when the sign-up didn't choose one.
    if (typeof req.body?.language !== "string" && settings.defaultLanguage && user.language !== settings.defaultLanguage) {
      set.language = settings.defaultLanguage;
    }
    const pending = !!settings.newUserApproval;
    if (pending) {
      set.status = "pending";
      set.statusChangedAt = new Date();
    }
    if (Object.keys(set).length) {
      // Approval required: park the account and revoke the tokens just issued.
      await User.updateOne({ _id: userId }, { $set: set, ...(pending ? { $inc: { tokenVersion: 1 } } : {}) });
    }
    const updatedUser = { ...user, ...set };
    delete updatedUser.statusChangedAt;
    PlatformService.alertNewUser({ ...updatedUser, _id: userId, status: updatedUser.status || "active" }).catch(
      () => {},
    );

    if (!pending) return set.language ? { ...body, data: { ...body.data, user: updatedUser } } : undefined;

    [config.accessCookieName, config.refreshCookieName].forEach((name) =>
      res.clearCookie(name, { ...config.cookie }),
    );
    const { tokens: _tokens, ...data } = body.data;
    return {
      ...body,
      message: "Your account has been created and is awaiting approval. We'll let you know once it's approved.",
      code: "ACCOUNT_PENDING",
      data: { ...data, user: updatedUser, pendingApproval: true },
    };
  });
  return next();
};

// ------------------------------------------------------------- restaurants

const restaurantApprovalGate = async (req, _res, next) => {
  try {
    if (req.body && typeof req.body === "object" && (await PlatformService.restaurantApprovalRequired())) {
      req.body.status = "pending";
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

export { accountStatusGate, newAccountPolicy, restaurantApprovalGate };
