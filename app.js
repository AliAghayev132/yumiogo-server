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
  CatalogService,
  OpeningHoursService,
  RestaurantStatsService,
  PlatformService,
  ModerationService,
  ReviewService,
  UploadSweepService,
  RestaurantFollowService,
  LinkPreviewService,
} from "#services";

// Middlewares
import {
  noCookies,
  apiRateLimiter,
  securityHeaders,
  uploadHeaders,
  sanitizeInput,
  maintenanceGate,
  accountStatusGate,
  newAccountPolicy,
  restaurantApprovalGate,
  notFoundHandler,
  errorHandler,
  localize,
  apiVersionAlias,
  appVersionGate,
} from "#middlewares";

// Routes
import {
  AuthRouter,
  RestaurantRouter,
  ReviewRouter,
  AdminRouter,
  FavoriteRouter,
  UserRouter,
  FeedRouter,
  NotificationRouter,
  UploadRouter,
  CatalogRouter,
  ContentRouter,
  CommentRouter,
  ReportRouter,
  PlacesRouter,
  WellKnownRouter,
  RootAppleRouter,
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
  const isProduction = process.env.NODE_ENV === "production";

  // Helmet for security headers (CSP covers the admin SPA served from here:
  // Google Fonts, remote https images, blob: previews of picked uploads).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:", "https:", ...(isProduction ? [] : ["http://localhost:*"])],
          connectSrc: ["'self'", ...(isProduction ? [] : ["ws://localhost:*", "http://localhost:*"])],
          // Local http testing of the built admin must not be forced to https.
          upgradeInsecureRequests: isProduction ? [] : null,
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
  // /api/v1/* → /api/* (versioned alias) + X-API-Version header
  app.use(apiVersionAlias);

  // Gzip compression
  app.use(compression());

  // CORS
  app.use(cors(corsConfig));

  // Accept-Language → req.lang; az / ru localize coded error messages
  app.use(localize);

  // Body parsers
  app.use(express.json({ limit: securityConfig.maxPayloadSize }));
  app.use(
    express.urlencoded({ extended: true, limit: securityConfig.maxPayloadSize }),
  );

  // NoSQL injection sanitization
  app.use(sanitizeInput);

  // Rate limiting for the API
  app.use("/api", apiRateLimiter);

  // Maintenance mode (503 for non-admin API calls while it is on)
  app.use("/api", maintenanceGate);

  // Minimum supported app version (426 for older apps that send X-App-Version)
  app.use("/api", appVersionGate);

  // Multipart parsing only where files are accepted, after the rate limiter,
  // with hard limits on file / part counts. Add new multipart routes here.
  app.use(
    ["/api/uploads", "/api/auth/avatar", "/api/admin/menu/uploads", "/api/admin/restaurants/:id/menu-photos"],
    fileUpload({
      limits: {
        fileSize: securityConfig.maxFileSize,
        files: securityConfig.maxUploadFiles,
        parts: securityConfig.maxUploadParts,
      },
      abortOnLimit: true,
      // Raw body (written by express-fileupload), kept in the JSON envelope.
      responseOnLimit: JSON.stringify({
        success: false,
        message: "File size limit exceeded (max 10MB)",
        code: "FILE_TOO_LARGE",
      }),
    }),
    sanitizeInput,
  );

  // Static files (uploads) — inert: no sniffing, no scripts, non-images download
  app.use("/uploads", express.static("uploads", { setHeaders: uploadHeaders }));
};

/**
 * Configure API routes
 */
const setupRoutes = (app) => {
  // Admin Settings policies around routes owned by other modules
  // (account approval / status, restaurant approval).
  app.post("/api/auth/login", accountStatusGate);
  app.use("/api/auth", newAccountPolicy);
  app.post(["/api/restaurants", "/api/admin/restaurants"], restaurantApprovalGate);

  app.use("/api/auth", AuthRouter);
  app.use("/api/restaurants", RestaurantRouter);
  app.use("/api/reviews", ReviewRouter);
  app.use("/api/admin", AdminRouter);
  app.use("/api/favorites", FavoriteRouter);
  app.use("/api/users", UserRouter);
  app.use("/api/feed", FeedRouter);
  app.use("/api/notifications", NotificationRouter);
  app.use("/api/uploads", UploadRouter);
  app.use("/api/catalog", CatalogRouter);
  app.use("/api/content", ContentRouter);
  app.use("/api/comments", CommentRouter);
  app.use("/api/reports", ReportRouter);
  app.use("/api/places", PlacesRouter);

  // Universal links / App Links (before the SPA fallback; JSON, no redirects).
  app.use("/.well-known", WellKnownRouter);
  app.use("/", RootAppleRouter);

  // Health check
  app.get("/api/health", async (req, res) => {
    const maintenance = await PlatformService.maintenance().catch(() => ({ enabled: false }));
    res.json({
      success: true,
      message: "Server is running",
      timestamp: new Date().toISOString(),
      mail: MailService.isConfigured() ? "configured" : "not-configured",
      maintenance: maintenance.enabled,
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

  // SPA fallback for anything that is not an API or upload request. The
  // public share landings (/restaurant, /list, /invite, /review) get Open
  // Graph / Twitter tags for link previews; everything else (admin) is the
  // untouched index.html (noindex).
  app.get(/^\/(?!api|uploads).*/, async (req, res, next) => {
    const client = resolveClientIndex();
    if (!client) return next(); // no build yet -> 404 handler
    try {
      const html = await LinkPreviewService.render(req, client.indexFile);
      if (html) {
        res.set("Cache-Control", "public, max-age=60");
        return res.type("html").send(html);
      }
    } catch (error) {
      console.error("Link preview error:", error.message);
    }
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
  app.use(notFoundHandler);

  // Central error handler (CastError/ValidationError/duplicate key → 400/409,
  // no stacks or internal messages in responses)
  app.use(errorHandler);
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
  // Opt-in: refuse to start without SMTP (sign-up / reset e-mails would 503).
  if (process.env.REQUIRE_SMTP === "true" && (!process.env.SMTP_USER || !process.env.SMTP_PASS)) {
    missing.push("SMTP_USER", "SMTP_PASS");
  }

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

  // Seed the admin-managed catalog/content defaults (idempotent), then keep
  // Restaurant.openNow in step with opening hours.
  try {
    await CatalogService.ensureDefaults();
  } catch (error) {
    console.error("❌ Error ensuring catalog defaults:", error.message);
  }
  OpeningHoursService.start();
  // Rolling restaurant activity stats ("Top this week", trending sorts).
  RestaurantStatsService.start();

  // Review migrations (live-only unique index, statuses, numbers, derived
  // ratings) + orphaned review-photo cleanup.
  try {
    await ReviewService.bootstrap();
  } catch (error) {
    console.error("❌ Error preparing reviews:", error.message);
  }

  // Restaurant "🔔 Follow" rows of deleted restaurants / accounts, and
  // followerCount drift (self-heal).
  try {
    const follows = await RestaurantFollowService.reconcile();
    if (follows.removed || follows.updated) {
      console.log(`✅ Restaurant follows reconciled (${follows.removed} removed, ${follows.updated} counts fixed)`);
    }
  } catch (error) {
    console.error("❌ Error reconciling restaurant follows:", error.message);
  }

  // Lift temporary suspensions when they end.
  ModerationService.start();

  // Admin uploads (restaurant / menu / catalog / content images) nothing
  // references any more — now and every 6 hours.
  await UploadSweepService.start();

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
  OpeningHoursService.stop();
  RestaurantStatsService.stop();
  ModerationService.stop();
  ReviewService.stop();
  UploadSweepService.stop();
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

// Crash reporting without extra services: every unexpected error lands in the
// PM2 log with a timestamp; an uncaught exception restarts the process (PM2).
process.on("unhandledRejection", (reason) => {
  console.error(`❌ [${new Date().toISOString()}] Unhandled rejection:`, reason?.stack || reason);
});
process.on("uncaughtException", (error) => {
  console.error(`❌ [${new Date().toISOString()}] Uncaught exception:`, error?.stack || error);
  process.exit(1);
});
