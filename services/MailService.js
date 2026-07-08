import { nodemailer } from "#lib";
import { config } from "#config";
import { otpTemplate, welcomeTemplate } from "#templates";

/**
 * MailService (static)
 * Thin wrapper over nodemailer with a couple of ready-made emails
 * (OTP verification + welcome). Extend with your own senders.
 */
class MailService {
  static transporter = null;

  /**
   * Initialize the SMTP transporter (call once at startup).
   * If SMTP is not configured, sends become no-ops with a warning.
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
    }
  }

  /**
   * Send an email
   * @param {Object} options - { to, subject, html }
   */
  static async send({ to, subject, html }) {
    if (!this.transporter) {
      console.warn("Mail service not configured (SMTP_USER/SMTP_PASS missing)");
      return { success: false, error: "Mail service not configured" };
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
      console.error("Mail send error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send an OTP verification code
   */
  static async sendOTP(email, code, type = "register") {
    // Dev convenience: with no SMTP configured, print the code to the server
    // console instead of failing, so the auth flow is testable locally.
    if (!this.transporter && process.env.NODE_ENV !== "production") {
      console.log(
        `\n${"=".repeat(52)}\n📧 [DEV] OTP for ${email} (${type}): ${code}\n${"=".repeat(52)}\n`,
      );
      return { success: true, dev: true };
    }

    const titles = {
      register: "Registration Verification",
      "reset-password": "Password Reset",
      "verify-email": "Email Verification",
    };

    const messages = {
      register: "Enter the code below to complete your registration:",
      "reset-password": "Enter the code below to reset your password:",
      "verify-email": "Enter the code below to verify your email address:",
    };

    return this.send({
      to: email,
      subject: `${titles[type]} - ${config.siteName}`,
      html: otpTemplate(titles[type], messages[type], code),
    });
  }

  /**
   * Send a welcome email (example of a domain-specific mail)
   */
  static async sendWelcome(email, firstName) {
    return this.send({
      to: email,
      subject: `Welcome to ${config.siteName}!`,
      html: welcomeTemplate(firstName, config.clientUrl),
    });
  }
}

export { MailService };
