// ============ EXTERNAL PACKAGES ============
import { http, cors, helmet, express, fileUpload, compression, fs, path } from "#lib";

// ============ INTERNAL IMPORTS ============
import { config, corsConfig, securityConfig } from "#config";

// Services
import {
  MailService,
  socketService,
  mongoDBService,
  bootstrapAdmin,
} from "#services";

// Middlewares
import {
  noCookies,
  apiRateLimiter,
  securityHeaders,
  sanitizeInput,
} from "#middlewares";

// Routes
import {
  AuthRouter,
  PostRouter,
  RestaurantRouter,
  ReviewRouter,
  AdminRouter,
  FavoriteRouter,
  UserRouter,
  FeedRouter,
  NotificationRouter,
  UploadRouter,
} from "#routes";

// ============ APP INSTANCE ============
const app = express();
const httpServer = http.createServer(app);

// Trust reverse proxy (nginx) - required for rate limiting behind a proxy
app.set("trust proxy", 1);

// ============ SETUP FUNCTIONS ============

/**
 * Configure security middlewares
 */
const setupSecurity = (app) => {
  // Helmet for security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:", "http://localhost:*"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  // Custom security headers
  app.use(securityHeaders);

  // Only allow essential/httpOnly cookies
  app.use(noCookies);
};

/**
 * Configure general middlewares
 */
const setupMiddlewares = (app) => {
  // Gzip compression
  app.use(compression());

  // CORS
  app.use(cors(corsConfig));

  // File upload (must be before body parsers to handle multipart/form-data)
  app.use(
    fileUpload({
      limits: { fileSize: securityConfig.maxFileSize },
      abortOnLimit: true,
      responseOnLimit: "File size limit exceeded (max 10MB)",
    }),
  );

  // Body parsers
  app.use(express.json({ limit: securityConfig.maxPayloadSize }));
  app.use(
    express.urlencoded({ extended: true, limit: securityConfig.maxPayloadSize }),
  );

  // NoSQL injection sanitization
  app.use(sanitizeInput);

  // Rate limiting for the API
  app.use("/api", apiRateLimiter);

  // Static files (uploads)
  app.use("/uploads", express.static("uploads"));
};

/**
 * Configure API routes
 */
const setupRoutes = (app) => {
  app.use("/api/auth", AuthRouter);
  app.use("/api/posts", PostRouter);
  app.use("/api/restaurants", RestaurantRouter);
  app.use("/api/reviews", ReviewRouter);
  app.use("/api/admin", AdminRouter);
  app.use("/api/favorites", FavoriteRouter);
  app.use("/api/users", UserRouter);
  app.use("/api/feed", FeedRouter);
  app.use("/api/notifications", NotificationRouter);
  app.use("/api/uploads", UploadRouter);

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({
      success: true,
      message: "Server is running",
      timestamp: new Date().toISOString(),
    });
  });
};


/**
 * Serve the built client when present, so a single proxy port (nginx ->
 * localhost:PORT) serves the site, the API and uploaded files.
 *
 * The build directory is resolved from CLIENT_DIST, otherwise from the layouts
 * we ship with: the monorepo (../admin-web/dist) and a VPS checkout where the
 * client repo sits next to the server one (../client/dist).
 *
 * Existence is re-checked per request, so deploying the client after the server
 * has started (or in either order) takes effect without a restart.
 */
const CLIENT_DIST_CANDIDATES = [
  process.env.CLIENT_DIST,
  "../admin-web/dist",
  "../client/dist",
].filter(Boolean);

const resolveClientIndex = () => {
  for (const dir of CLIENT_DIST_CANDIDATES) {
    const indexFile = path.resolve(dir, "index.html");
    if (fs.existsSync(indexFile)) return { dir: path.resolve(dir), indexFile };
  }
  return null;
};

const setupClient = (app) => {
  // Static assets: express.static simply falls through when a path is missing.
  CLIENT_DIST_CANDIDATES.forEach((dir) => {
    app.use(express.static(path.resolve(dir), { maxAge: "1h", index: false }));
  });

  // SPA fallback for anything that is not an API or upload request.
  app.get(/^\/(?!api|uploads).*/, (req, res, next) => {
    const client = resolveClientIndex();
    if (!client) return next(); // no build yet -> 404 handler
    return res.sendFile(client.indexFile);
  });

  const found = resolveClientIndex();
  console.log(
    found
      ? `✅ Serving client from ${found.dir}`
      : `ℹ️  No client build found (looked in: ${CLIENT_DIST_CANDIDATES.join(", ")}) — serving API only`,
  );
};

/**
 * Configure error handlers
 */
const setupErrorHandlers = (app) => {
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: "Endpoint not found",
    });
  });

  // Central error handler
  app.use((err, req, res, _next) => {
    console.error("Server error:", err.message || err);

    // Mongoose validation error
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: Object.values(err.errors).map((e) => e.message),
      });
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This record already exists",
      });
    }

    // JWT errors
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Session expired",
      });
    }

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? "Server error" : err.message,
    });
  });
};

/**
 * Validate required environment variables in production
 */
const validateEnv = () => {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) return;

  // Must match the fallbacks in config/config.js.
  const defaults = {
    ACCESS_SECRET_KEY: "yumio_dev_access_secret_key_change_me",
    REFRESH_SECRET_KEY: "yumio_dev_refresh_secret_key_change_me",
    ENCRYPTION_KEY: "yumio_dev_32_char_encryption_key",
  };

  const missing = Object.entries(defaults)
    .filter(([key, defaultVal]) => !process.env[key] || process.env[key] === defaultVal)
    .map(([key]) => key);

  if (!process.env.MONGODB_URI) missing.push("MONGODB_URI");

  if (missing.length) {
    console.error(
      [
        "",
        "❌ Missing production configuration — refusing to start.",
        `   Set these in server/.env: ${missing.join(", ")}`,
        "",
        "   Generate secrets with:  openssl rand -hex 32",
        "   Example MONGODB_URI:    mongodb://127.0.0.1:27017/yumio",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log("✅ Environment variables validated");
};

/**
 * Initialize all services
 */
const initializeServices = async () => {
  validateEnv();

  // Connect to the database
  await mongoDBService.connect();

  // Create the default admin if none exists
  await bootstrapAdmin();

  // Initialize the mail service
  MailService.init();
};

/**
 * Print startup banner
 */
const printBanner = (port) => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 ${config.siteName} Server                               ║
║                                                              ║
║   Running on port ${port}                                      ║
║   Environment: ${process.env.NODE_ENV || "development"}                             ║
║                                                              ║
║   ✅ Security headers active                                 ║
║   ✅ Rate limiting enabled                                   ║
║   ✅ NoSQL sanitization enabled                              ║
║   ✅ Socket.IO ready                                         ║
║                                                              ║
╚════════════════════════════════════════════════════════════╝
  `);
};

// ============ BOOTSTRAP APPLICATION ============

/**
 * Start the application
 */
const startApp = async () => {
  try {
    setupSecurity(app);
    setupMiddlewares(app);
    setupRoutes(app);
    setupClient(app);
    setupErrorHandlers(app);

    await initializeServices();

    // Initialize Socket.IO
    socketService.init(httpServer);

    const port = config.development.port;
    httpServer.listen(port, () => printBanner(port));
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startApp();

// ============ GRACEFUL SHUTDOWN ============
const shutdown = async (signal) => {
  console.log(`\n⚠️  ${signal} received. Shutting down gracefully...`);
  httpServer.close(async () => {
    await mongoDBService.disconnect();
    console.log("✅ Server closed");
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error("❌ Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
