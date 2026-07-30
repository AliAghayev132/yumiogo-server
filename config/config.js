import { dotenv } from "#lib";

const NODE_ENV = process.env.NODE_ENV || "development";

// Load environment-specific file first (e.g. .env.development), then fall back to .env.
// dotenv does not override already-defined variables, so the first match wins.
dotenv.config({ path: `.env.${NODE_ENV}` });
dotenv.config();

const isProduction = NODE_ENV === "production";

// Production runs behind nginx on PROXY_PORT for https://yumiogo.com.
const domain = process.env.DOMAIN || (isProduction ? "yumiogo.com" : "localhost");

// Single proxy port: nginx forwards yumiogo.com -> localhost:3042.
const port = Number(process.env.PORT) || 3042;

const config = {
  development: {
    port,
    db: {
      host: process.env.DB_HOST || "localhost",
      name: process.env.DB_NAME || "yumio",
      username: process.env.DB_USERNAME || "",
      password: process.env.DB_PASSWORD || "",
      clusterName: process.env.DB_CLUSTER_NAME || "",
    },
  },

  // Site
  siteName: "Yumio",
  domain,
  appUrl:
    process.env.APP_URL || (isProduction ? `https://${domain}` : `http://localhost:${port}`),
  clientUrl:
    process.env.CLIENT_URL ||
    (isProduction ? `https://${domain}` : "http://localhost:5173"),

  // Auth secrets (override in production via env)
  accessSecretKey: process.env.ACCESS_SECRET_KEY || "yumio_dev_access_secret_key_change_me",
  refreshSecretKey: process.env.REFRESH_SECRET_KEY || "yumio_dev_refresh_secret_key_change_me",
  encryptionKey: process.env.ENCRYPTION_KEY || "yumio_dev_32_char_encryption_key",

  // Default admin (created on first boot by BootstrapService)
  defaultAdmin: {
    email: process.env.DEFAULT_ADMIN_EMAIL || "admin@yumio.app",
    password: process.env.DEFAULT_ADMIN_PASSWORD || "Admin123!",
  },

  // Cookie names (prefixed to avoid collisions)
  accessCookieName: "__yumio_at",
  refreshCookieName: "__yumio_rt",

  // Cookie options
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    domain: isProduction ? `.${domain}` : undefined,
    path: "/",
  },

  // Token durations (ms)
  accessTokenMaxAge: 15 * 60 * 1000, // 15 minutes
  refreshTokenMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  rememberMeMaxAge: 30 * 24 * 60 * 60 * 1000, // 30 days

  // OTP
  otpExpiresIn: 600, // 10 minutes (seconds)

  // SMTP
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    secure: process.env.SMTP_SECURE === "true",
  },
};

// CORS whitelist
const corsConfig = {
  origin: isProduction
    ? [
        process.env.CLIENT_URL,
        `https://${domain}`,
        `https://www.${domain}`,
        `http://${domain}`,
        `http://www.${domain}`,
      ].filter(Boolean)
    : [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        `http://localhost:${port}`,
      ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Authorization", "Content-Type"],
  credentials: true,
};

// Extra security-related knobs
const securityConfig = {
  // Session timeout hint (15 minutes)
  sessionTimeout: 15 * 60 * 1000,
  // Max request/upload payload size
  maxPayloadSize: "10mb",
  maxFileSize: 10 * 1024 * 1024, // 10MB
};

export { config, corsConfig, securityConfig };
