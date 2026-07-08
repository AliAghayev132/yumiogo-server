import { baseTemplate } from "./baseTemplate.js";

/**
 * OTP verification email template
 */
export const otpTemplate = (title, message, code) => {
  const content = `
    <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.5;">
      ${message}
    </p>

    <!-- OTP Code -->
    <div style="background-color: #f8f9fa; border: 2px dashed #e0e0e0; border-radius: 12px; padding: 25px; margin: 0 auto; max-width: 250px;">
      <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2E3031;">${code}</span>
    </div>

    <p style="margin: 30px 0 0; color: #999999; font-size: 13px;">
      This code is valid for <strong>10 minutes</strong>.
    </p>
    <p style="margin: 10px 0 0; color: #999999; font-size: 13px;">
      If you did not request this, please ignore this email.
    </p>
  `;

  return baseTemplate(title, content);
};
