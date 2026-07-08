import { baseTemplate } from "./baseTemplate.js";

/**
 * Welcome email template (example of a domain-specific email)
 */
export const welcomeTemplate = (firstName, clientUrl) => {
  const content = `
    <h2 style="margin: 0 0 16px; color: #2E3031; font-size: 22px;">
      Welcome${firstName ? `, ${firstName}` : ""}! 🎉
    </h2>
    <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.5;">
      Your account has been created successfully. We're glad to have you on board.
    </p>

    <a href="${clientUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
      Get Started
    </a>

    <p style="margin: 30px 0 0; color: #999999; font-size: 13px;">
      If you have any questions, just reply to this email.
    </p>
  `;

  return baseTemplate("Welcome", content);
};
