// Services
import { TranslationService } from "#services";

// Utils
import { asyncHandler } from "#utils";

/**
 * AI translation of admin content (en / az / ru) through OpenRouter.
 * Mounted under /api/admin (authenticated admin only). See TranslationService.
 */

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, code });

/**
 * Whether the "Translate with AI" buttons should be shown.
 * GET /api/admin/translate/status → { enabled, model }
 */
const getTranslateStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, data: TranslationService.status() });
});

/**
 * Translate texts into the other languages — one model call per request.
 * POST /api/admin/translate
 *   { from: "en"|"az"|"ru", to: ["az", "ru"], texts: { "<key>": "string" | ["string", …] } }
 * → { translations: { "<lang>": { "<key>": "string" | [..] } } }
 * Keys are opaque (e.g. "name", "sections.2.body"); arrays keep their length,
 * empty strings stay empty. Max 200 keys / 30 000 characters.
 */
const translate = asyncHandler(async (req, res) => {
  if (!TranslationService.isEnabled()) {
    return fail(res, 503, "AI translation is not configured on the server", "TRANSLATE_NOT_CONFIGURED");
  }
  const { request, error } = TranslationService.validate(req.body || {}, req.rawBody?.texts);
  if (error) return fail(res, 400, error, "TRANSLATE_INVALID");

  try {
    const { translations } = await TranslationService.translate(request);
    res.json({ success: true, data: { translations } });
  } catch (err) {
    if (err instanceof TranslationService.TranslationError) return fail(res, err.status, err.message, err.code);
    throw err;
  }
});

export { getTranslateStatus, translate };
