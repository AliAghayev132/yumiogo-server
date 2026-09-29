/**
 * An Error that carries an HTTP status. Throw it from services; asyncHandler
 * forwards it and the central error handler replies with that status and
 * message (4xx messages are shown to the client as-is).
 *
 * Usage:
 *   if (!user) throw httpError(404, "User not found");
 */
const httpError = (statusCode, message, extra = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
};

export { httpError };
