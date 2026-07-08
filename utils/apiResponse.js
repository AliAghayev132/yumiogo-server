/**
 * Small helpers to build the standard response envelope:
 *   { success, message?, data?, errors? }
 *
 * Usage:
 *   return ok(res, { user }, "Logged in");
 *   return fail(res, "Invalid credentials", 401);
 */

const ok = (res, data = null, message, status = 200) => {
  const body = { success: true };
  if (message) body.message = message;
  if (data !== null) body.data = data;
  return res.status(status).json(body);
};

const fail = (res, message, status = 400, errors) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
};

export { ok, fail };
