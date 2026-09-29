import { emailCopy } from "#i18n/index.js";
import { baseTemplate, brand, escapeHtml } from "./baseTemplate.js";

/**
 * "New follower" email (Settings → Email Notification → Receive new follower
 * emails), in the recipient's language (en | az | ru).
 */
export const newFollowerTemplate = (firstName, actorName, appUrl, lang = "en") => {
  const copy = emailCopy(lang);
  const greeting = copy.followerGreeting.replace("{name}", firstName ? ` ${escapeHtml(firstName)}` : "");
  const content = `
    <p style="margin: 0 0 12px; color: ${brand.muted}; font-size: 16px;">
      ${greeting}
    </p>
    <h2 style="margin: 0 0 24px; color: ${brand.text}; font-size: 20px; line-height: 1.4;">
      ${copy.followerHeading.replace("{actor}", escapeHtml(actorName))}
    </h2>

    <a href="${escapeHtml(appUrl)}" style="display: inline-block; background-color: ${brand.orange}; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
      ${escapeHtml(copy.followerCta)}
    </a>

    <p style="margin: 28px 0 0; color: ${brand.subtle}; font-size: 13px;">
      ${escapeHtml(copy.followerFooter)}
    </p>
  `;

  return baseTemplate(copy.followerTitle, content);
};
