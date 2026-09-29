import { emailCopy } from "#i18n/index.js";
import { baseTemplate, brand, escapeHtml } from "./baseTemplate.js";

/**
 * Welcome email template (sent after registration), in `lang` (en | az | ru).
 */
export const welcomeTemplate = (firstName, clientUrl, lang = "en") => {
  const copy = emailCopy(lang);
  const heading = copy.welcomeHeading.replace("{name}", firstName ? `, ${escapeHtml(firstName)}` : "");
  const content = `
    <h2 style="margin: 0 0 16px; color: ${brand.text}; font-size: 22px;">
      ${heading}
    </h2>
    <p style="margin: 0 0 28px; color: ${brand.muted}; font-size: 16px; line-height: 1.5;">
      ${escapeHtml(copy.welcomeBody)}
    </p>

    <a href="${escapeHtml(clientUrl)}" style="display: inline-block; background-color: ${brand.orange}; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600;">
      ${escapeHtml(copy.welcomeCta)}
    </a>

    <p style="margin: 28px 0 0; color: ${brand.subtle}; font-size: 13px;">
      ${escapeHtml(copy.welcomeFooter)}
    </p>
  `;

  return baseTemplate(copy.welcomeTitle, content);
};
