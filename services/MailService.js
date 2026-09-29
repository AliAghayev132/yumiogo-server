import { nodemailer } from "#lib";
import { config } from "#config";
import { otpTemplate, welcomeTemplate, newFollowerTemplate } from "#templates";
import { emailCopy, fill } from "#i18n/index.js";

/**
 * MailService (static)
 * Thin wrapper over nodemailer with the app's ready-made emails
 * (OTP verification, welcome, new follower).
 *
 * Every sender resolves to { success, notConfigured?, error? } and never
 * throws, so callers can answer 503 when mail is unavailable. Subjects and
 * bodies are sent in `lang` (en | az | ru — i18n/messages.js EMAIL_COPY).
 */
class MailService {
  static transporter = null;

  /**
   * Initialize the SMTP transporter (call once at startup).
   * If SMTP is not configured, sends fail with { notConfigured: true }.
   */
  static init() {
    if (config.smtp.user && config.smtp.pass) {
      this.transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      });
    } else if (process.env.NODE_ENV === "production") {
      console.warn("⚠️  SMTP_USER/SMTP_PASS missing — sign-up and password reset e-mails are disabled (503)");
    }
  }

  /** True when e-mails can actually be delivered. */
  static isConfigured() {
    return !!this.transporter;
  }

  /**
   * Send an email
   * @param {Object} options - { to, subject, html }
   */
  static async send({ to, subject, html }) {
    if (!this.transporter) {
      console.warn("Mail service not configured (SMTP_USER/SMTP_PASS missing)");
      return { success: false, notConfigured: true, error: "Mail service not configured" };
    }

    try {
      await this.transporter.sendMail({
        from: `"${config.siteName}" <${config.smtp.user}>`,
        to,
        subject,
        html,
      });
      return { success: true };
    } catch (error) {
      console.error("Mail send error:", error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send an OTP verification code
   * @param {string} email
   * @param {string} code
   * @param {string} type - register | reset-password | verify-email
   * @param {number} minutes - code validity shown in the mail
   * @param {string} lang - en | az | ru
   */
  static async sendOTP(email, code, type = "register", minutes = Math.round(config.otpExpiresIn / 60), lang = "en") {
    // Dev convenience: with no SMTP configured, print the code to the server
    // console instead of failing, so the auth flow is testable locally.
    if (!this.transporter && process.env.NODE_ENV !== "production") {
      console.log(
        `\n${"=".repeat(52)}\n📧 [DEV] OTP for ${email} (${type}): ${code}\n${"=".repeat(52)}\n`,
      );
      return { success: true, dev: true };
    }

    const copy = emailCopy(lang);
    const title = copy.otpTitle[type] || copy.otpTitle.register;
    const message = copy.otpMessage[type] || copy.otpMessage.register;

    return this.send({
      to: email,
      subject: `${title} - ${config.siteName}`,
      html: otpTemplate(title, message, code, minutes, lang),
    });
  }

  /**
   * Send a welcome email
   */
  static async sendWelcome(email, firstName, lang = "en") {
    if (!this.transporter) return { success: false, notConfigured: true };
    return this.send({
      to: email,
      subject: fill(emailCopy(lang).welcomeSubject, { app: config.siteName }),
      html: welcomeTemplate(firstName, config.appUrl, lang),
    });
  }

  /**
   * "<actor> started following you" email (recipient's emailNotifications toggle).
   */
  static async sendNewFollower(email, firstName, actorName, lang = "en") {
    if (!this.transporter) return { success: false, notConfigured: true };
    return this.send({
      to: email,
      subject: fill(emailCopy(lang).followerSubject, { actor: actorName, app: config.siteName }),
      html: newFollowerTemplate(firstName, actorName, config.appUrl, lang),
    });
  }
}

export { MailService };
