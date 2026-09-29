import { SocketServer, jwt } from "#lib";
import { config, corsConfig } from "#config";
import { User } from "#models";

/**
 * SocketService (singleton) — server → client push.
 *
 * Every authenticated socket joins its own room `user:<id>`; admins also join
 * `admins`. The server pushes domain events there; clients never relay
 * messages to each other (the template's open chat relay was removed).
 *
 * Handshake auth checks the access token AND the account: it must exist, not
 * be deleted, be active and carry the current tokenVersion.
 *
 * Events emitted (server → client):
 *   account:status    { status, reason, until }   to one user (ban/suspend/restore)
 *   notification:new  { message, type, ... }       to one user / everyone
 *   admin:alert       { kind, message, ... }       to the admins room
 *   app:maintenance   { maintenance, message }     to everyone
 */
const ADMINS_ROOM = "admins";
const userRoom = (userId) => `user:${userId}`;

class SocketService {
  constructor() {
    this.io = null;
  }

  /**
   * Initialize Socket.IO with the HTTP server
   */
  init(httpServer) {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: corsConfig.origin,
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.io.use(this.authMiddleware.bind(this));
    this.io.on("connection", (socket) => {
      socket.join(userRoom(socket.userId));
      if (socket.userRole === "admin") socket.join(ADMINS_ROOM);
    });

    return this.io;
  }

  /**
   * Authentication middleware for Socket.IO: verifies the access token passed
   * in the handshake and that the account is still allowed in.
   */
  async authMiddleware(socket, next) {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication required"));

      const decoded = jwt.verify(token, config.accessSecretKey);
      const user = await User.findById(decoded.id).select("role status isDeleted tokenVersion").lean();

      if (
        !user ||
        user.isDeleted ||
        user.status !== "active" ||
        decoded.tokenVersion !== user.tokenVersion
      ) {
        return next(new Error("Session expired"));
      }

      socket.userId = String(user._id);
      socket.userRole = user.role;
      return next();
    } catch (_error) {
      return next(new Error("Invalid token"));
    }
  }

  /** Emit to every socket of one user. */
  emitToUser(userId, event, data) {
    if (!this.io || !userId) return;
    this.io.to(userRoom(userId)).emit(event, data);
  }

  /** Emit to every connected admin. */
  emitToAdmins(event, data) {
    if (!this.io) return;
    this.io.to(ADMINS_ROOM).emit(event, data);
  }

  /** Emit to every connected socket. */
  broadcast(event, data) {
    if (!this.io) return;
    this.io.emit(event, data);
  }

  /** Emit to a named room (kept for callers of the old API). */
  emitToRoom(roomId, event, data) {
    if (!this.io) return;
    this.io.to(`room:${roomId}`).emit(event, data);
  }

  /** Force-disconnect every socket of a user (ban / suspend / delete). */
  disconnectUser(userId) {
    if (!this.io || !userId) return;
    this.io.in(userRoom(userId)).disconnectSockets(true);
  }

  /**
   * Get the raw IO instance
   */
  getIO() {
    return this.io;
  }
}

// Export singleton instance
const socketService = new SocketService();
export default socketService;
