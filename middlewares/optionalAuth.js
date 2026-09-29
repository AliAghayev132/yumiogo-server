import { jwt } from "#lib";
import { config } from "#config";
import { User } from "#models";

/**
 * Optional authentication for public endpoints that personalise their answer
 * (recently viewed, friend picks, view de-duplication).
 *
 *  - no Authorization header → guest (req.user stays undefined);
 *  - valid access token → req.user like `authenticate`;
 *  - expired token → 401 TOKEN_EXPIRED, so the client refreshes and replays;
 *  - any other bad token / inactive account → treated as a guest.
 */
const optionalAuth = async (req, res, next) => {
  const header = req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) return next();

  try {
    const decoded = jwt.verify(header.slice(7), config.accessSecretKey);
    const user = await User.findById(decoded.id).select("-password");
    if (user && !user.isDeleted && user.status === "active" && decoded.tokenVersion === user.tokenVersion) {
      req.user = user;
    }
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Session expired",
        code: "TOKEN_EXPIRED",
      });
    }
    return next();
  }
};

export { optionalAuth };
