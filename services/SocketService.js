import { SocketServer, jwt } from "#lib";
import { config, corsConfig } from "#config";

/**
 * SocketService (singleton)
 *
 * Generic real-time layer built around a "room" concept. A room can be
 * anything in your domain (a chat thread, a document, a post's comments, ...).
 * Clients authenticate with their access token, then join/leave rooms and
 * exchange messages / typing indicators.
 *
 * Events handled (client -> server):
 *   join:room      (roomId)
 *   leave:room     (roomId)
 *   typing:start   (roomId)
 *   typing:stop    (roomId)
 *   message:new    ({ roomId, message })
 *
 * Events emitted (server -> client):
 *   user:joined, user:left, user:typing, user:stopped_typing, message:new
 */
class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // Map<roomId, Set<socketId>>
    this.socketToUser = new Map(); // Map<socketId, { id, roomId }>
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
    this.setupEventHandlers();

    return this.io;
  }

  /**
   * Authentication middleware for Socket.IO
   * Verifies the access token passed in the handshake.
   */
  async authMiddleware(socket, next) {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, config.accessSecretKey);

      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      socket.user = decoded;

      next();
    } catch (_error) {
      return next(new Error("Invalid token"));
    }
  }

  /**
   * Register Socket.IO event handlers
   */
  setupEventHandlers() {
    this.io.on("connection", (socket) => {
      // Join a room
      socket.on("join:room", (roomId) => {
        this.joinRoom(socket, roomId);
      });

      // Leave a room
      socket.on("leave:room", (roomId) => {
        this.leaveRoom(socket, roomId);
      });

      // Typing indicators
      socket.on("typing:start", (roomId) => {
        socket.to(`room:${roomId}`).emit("user:typing", {
          roomId,
          userId: socket.userId,
        });
      });

      socket.on("typing:stop", (roomId) => {
        socket.to(`room:${roomId}`).emit("user:stopped_typing", {
          roomId,
          userId: socket.userId,
        });
      });

      // New message broadcast to a room
      socket.on("message:new", ({ roomId, message }) => {
        this.io.to(`room:${roomId}`).emit("message:new", {
          roomId,
          message,
          userId: socket.userId,
          sentAt: new Date(),
        });
      });

      // Disconnect
      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });
    });
  }

  /**
   * Join a room and track membership
   */
  joinRoom(socket, roomId) {
    const roomName = `room:${roomId}`;
    socket.join(roomName);

    if (!this.connectedUsers.has(roomId)) {
      this.connectedUsers.set(roomId, new Set());
    }
    this.connectedUsers.get(roomId).add(socket.id);

    this.socketToUser.set(socket.id, { id: socket.userId, roomId });

    socket.to(roomName).emit("user:joined", {
      roomId,
      userId: socket.userId,
    });
  }

  /**
   * Leave a room and clean up tracking
   */
  leaveRoom(socket, roomId) {
    const roomName = `room:${roomId}`;
    socket.leave(roomName);

    if (this.connectedUsers.has(roomId)) {
      this.connectedUsers.get(roomId).delete(socket.id);
      if (this.connectedUsers.get(roomId).size === 0) {
        this.connectedUsers.delete(roomId);
      }
    }
    this.socketToUser.delete(socket.id);

    socket.to(roomName).emit("user:left", {
      roomId,
      userId: socket.userId,
    });
  }

  /**
   * Handle socket disconnect
   */
  handleDisconnect(socket) {
    const info = this.socketToUser.get(socket.id);
    if (info) {
      this.leaveRoom(socket, info.roomId);
    }
  }

  /**
   * Emit an event to everyone in a room (from server-side code)
   */
  emitToRoom(roomId, event, data) {
    if (!this.io) return;
    this.io.to(`room:${roomId}`).emit(event, data);
  }

  /**
   * Emit an event to a specific connected user
   */
  emitToUser(userId, event, data) {
    if (!this.io) return;
    for (const [socketId, info] of this.socketToUser.entries()) {
      if (info.id === userId) {
        this.io.to(socketId).emit(event, data);
      }
    }
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
