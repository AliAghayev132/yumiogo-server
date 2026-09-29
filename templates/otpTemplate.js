import { emailCopy, fill } from "#i18n/index.js";
import { baseTemplate, brand, escapeHtml } from "./baseTemplate.js";

/**
 * OTP verification email template.
 * @param {string} title
 * @param {string} message
 * @param {string} code - the verification code (4 digits)
 * @param {number} minutes - how long the code stays valid
 * @param {string} lang - en | az | ru (footer lines)
 */
export const otpTemplate = (title, message, code, minutes = 10, lang = "en") => {
  const copy = emailCopy(lang);
  const content = `
    <p style="margin: 0 0 28px; color: ${brand.muted}; font-size: 16px; line-height: 1.5;">
      ${escapeHtml(message)}
    </p>

    <!-- OTP Code -->
    <div style="background-color: ${brand.surface}; border: 1px solid ${brand.border}; border-radius: 8px; padding: 20px; margin: 0 auto; max-width: 220px;">
      <span style="font-size: 36px; font-weight: 700; letter-spacing: 12px; color: ${brand.text};">${escapeHtml(code)}</span>
    </div>

    <p style="margin: 28px 0 0; color: ${brand.subtle}; font-size: 13px;">
      ${fill(copy.otpValidity, { minutes: Number(minutes) || 10 })}
    </p>
    <p style="margin: 10px 0 0; color: ${brand.subtle}; font-size: 13px;">
      ${escapeHtml(copy.otpIgnore)}
    </p>
  `;

  return baseTemplate(title, content);
};
