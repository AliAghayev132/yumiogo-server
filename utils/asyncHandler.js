/**
 * Wraps an async route handler to catch errors automatically.
 * Eliminates repetitive try/catch blocks in controllers.
 *
 * @param {Function} fn - Async route handler (req, res, next)
 * @returns {Function} - Express middleware
 *
 * Usage:
 *   const getUsers = asyncHandler(async (req, res) => {
 *     const users = await User.find();
 *     res.json({ success: true, data: users });
 *   });
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export { asyncHandler };
