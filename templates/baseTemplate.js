import { config } from "#config";

/** Escape a value for safe interpolation into e-mail HTML. */
export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Yumio brand tokens (Figma): green #22C55E, CTA orange #F97316, neutrals.
export const brand = {
  green: "#22C55E",
  orange: "#F97316",
  text: "#212121",
  muted: "#616161",
  subtle: "#757575",
  border: "#E0E0E0",
  surface: "#FAFAFA",
  font: "'Plus Jakarta Sans', 'DM Sans', 'Segoe UI', Arial, sans-serif",
};

/**
 * Base email template wrapper.
 * All emails share this layout (brand header + content slot + footer).
 * `title` is escaped here; `content` must already be safe HTML.
 */
export const baseTemplate = (title, content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: ${brand.font}; background-color: ${brand.surface};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${brand.surface}; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid ${brand.border}; border-radius: 12px; overflow: hidden; max-width: 480px;">
          <!-- Header -->
          <tr>
            <td style="background-color: ${brand.green}; padding: 28px 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: 0.5px;">${escapeHtml(config.siteName)}</h1>
              <p style="margin: 6px 0 0; color: #ffffff; opacity: 0.9; font-size: 14px;">${escapeHtml(title)}</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 36px 24px; text-align: center; color: ${brand.text};">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: ${brand.surface}; padding: 18px 24px; text-align: center; border-top: 1px solid ${brand.border};">
              <p style="margin: 0; color: ${brand.subtle}; font-size: 12px;">
                © ${new Date().getFullYear()} ${escapeHtml(config.siteName)}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
