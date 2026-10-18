import { config } from "#config";

/**
 * TranslationService — AI translation of admin content (taxonomy names, FAQs,
 * legal pages, onboarding, settings copy …) between en / az / ru through
 * OpenRouter (chat completions, a Gemini model by default).
 *
 *  - status(): { enabled, model } — enabled only with OPENROUTER_API_KEY.
 *  - validate(body): checks a POST /api/admin/translate payload.
 *  - translate(request): ONE model call per request (structured JSON output),
 *    retried once when the reply is malformed (bad JSON, missing segments, or
 *    changed placeholders / link targets).
 *
 * Every non-empty string (array items included) becomes a numbered segment
 * ("s0", "s1", …), so the model never sees the panel's keys and the reply is
 * mapped back onto them by position. Empty strings stay empty and are not
 * sent. Neither the API key nor the texts are ever logged.
 */

const LANGUAGES = ["en", "az", "ru"];
const LANGUAGE_NAMES = { en: "English", az: "Azerbaijani (Latin script)", ru: "Russian" };

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_KEYS = 200;
const MAX_CHARS = 30000;
const MAX_ARRAY_ITEMS = 100;
const MAX_KEY_LENGTH = 200;
const TIMEOUT_MS = 45 * 1000;
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Tokens that must come back verbatim: {placeholders}, markdown link targets
// and bare URLs.
const PLACEHOLDER = /\{[A-Za-z0-9_.]+\}/g;
const LINK_TARGET = /\]\(([^)\s]*)\)/g;
const BARE_URL = /https?:\/\/[^\s)\]]+/g;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value) => typeof value === "string" && value.trim() !== "";

/** Sorted list of the protected tokens of a text (compared as a multiset). */
const protectedTokens = (text) =>
  [
    ...(text.match(PLACEHOLDER) || []),
    ...[...text.matchAll(LINK_TARGET)].map((m) => `](${m[1]})`),
    ...(text.match(BARE_URL) || []),
  ].sort();

class TranslationError extends Error {
  constructor(message, { status = 502, code = "TRANSLATE_FAILED" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SYSTEM_PROMPT = (from, to) =>
  [
    `You are a professional translator for Yumio, a restaurant discovery app in Azerbaijan.`,
    `Translate every segment from ${LANGUAGE_NAMES[from]} into ${to.map((l) => LANGUAGE_NAMES[l]).join(" and ")}.`,
    "The texts are app content written by an admin: cuisine / feature names, FAQ answers, legal pages, button labels, notification copy.",
    "Rules:",
    "- Translate naturally and concisely, in the tone of a friendly consumer app; keep the meaning exact.",
    "- Keep Markdown exactly: headings, lists, bold / italics, '> ' note lines, '| a | b |' table rows and line breaks (\\n).",
    "- Keep link targets unchanged: in [label](url) translate only the label, never the url.",
    "- Keep every placeholder in curly braces verbatim, e.g. {maxDiscount}, {name}, {appLinks.ios}. Never translate or remove them.",
    "- Keep emoji, numbers, prices, the ₼ sign, % signs, URLs, e-mail addresses and the brand name \"Yumio\" unchanged.",
    "- Do not add explanations, quotes or notes. Do not merge or split segments.",
    `- Reply with ONLY a JSON object: { ${to.map((l) => `"${l}": { "<segment id>": "<translation>" }`).join(", ")} } with every segment id of the input.`,
  ].join("\n");

// Strict JSON schema of the reply: every target language, every segment id.
const replySchema = (to, ids) => {
  const language = {
    type: "object",
    properties: Object.fromEntries(ids.map((id) => [id, { type: "string" }])),
    required: ids,
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: Object.fromEntries(to.map((lang) => [lang, language])),
    required: to,
    additionalProperties: false,
  };
};

/** The model's reply → { byLang } or { error } (why it is malformed). */
const parseReply = (content, to, segments) => {
  if (typeof content !== "string" || !content.trim()) return { error: "empty reply" };
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    return { error: "the reply was not valid JSON" };
  }
  if (!isPlainObject(parsed)) return { error: "the reply was not a JSON object" };

  const byLang = {};
  for (const lang of to) {
    const entry = parsed[lang];
    if (!isPlainObject(entry)) return { error: `"${lang}" was missing` };
    byLang[lang] = {};
    for (const segment of segments) {
      const value = entry[segment.id];
      if (!hasText(value)) return { error: `segment ${segment.id} of "${lang}" was missing or empty` };
      if (protectedTokens(value).join("\u0000") !== segment.tokens) {
        return { error: `segment ${segment.id} of "${lang}" changed a placeholder or link` };
      }
      byLang[lang][segment.id] = value;
    }
  }
  return { byLang };
};

class TranslationService {
  static LANGUAGES = LANGUAGES;
  static MAX_KEYS = MAX_KEYS;
  static MAX_CHARS = MAX_CHARS;
  static TranslationError = TranslationError;

  static isEnabled() {
    return !!config.openRouter.apiKey;
  }

  static status() {
    return { enabled: this.isEnabled(), model: config.openRouter.model };
  }

  /**
   * Validate { from, to, texts } (texts: the raw map, keys kept as sent).
   * → { request: { from, to, texts, segments } } | { error }
   */
  static validate(body, rawTexts) {
    const from = typeof body?.from === "string" ? body.from.trim().toLowerCase() : "";
    if (!LANGUAGES.includes(from)) return { error: `from must be one of ${LANGUAGES.join(", ")}` };

    const toList = Array.isArray(body?.to) ? body.to : typeof body?.to === "string" ? [body.to] : null;
    if (!toList || !toList.length) return { error: "to must be a non-empty list of languages" };
    const to = [];
    for (const raw of toList) {
      const lang = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!LANGUAGES.includes(lang)) return { error: `to must only contain ${LANGUAGES.join(", ")}` };
      if (lang === from) return { error: "to must not contain the source language" };
      if (!to.includes(lang)) to.push(lang);
    }

    const texts = rawTexts !== undefined ? rawTexts : body?.texts;
    if (!isPlainObject(texts)) return { error: "texts must be an object of strings or string arrays" };
    const keys = Object.keys(texts);
    if (!keys.length) return { error: "texts must not be empty" };
    if (keys.length > MAX_KEYS) return { error: `At most ${MAX_KEYS} texts per request` };

    const segments = [];
    let chars = 0;
    const addSegment = (key, index, value) => {
      if (typeof value !== "string") return `texts["${key}"] must be a string or an array of strings`;
      chars += value.length;
      if (hasText(value)) {
        segments.push({ id: `s${segments.length}`, key, index, text: value, tokens: protectedTokens(value).join("\u0000") });
      }
      return null;
    };
    for (const key of keys) {
      if (!key || key.length > MAX_KEY_LENGTH || BLOCKED_KEYS.has(key)) return { error: `Invalid text key: ${key.slice(0, 40)}` };
      const value = texts[key];
      let error = null;
      if (Array.isArray(value)) {
        if (value.length > MAX_ARRAY_ITEMS) return { error: `texts["${key}"] has more than ${MAX_ARRAY_ITEMS} items` };
        value.forEach((item, index) => {
          error = error || addSegment(key, index, item);
        });
      } else {
        error = addSegment(key, null, value);
      }
      if (error) return { error };
    }
    if (chars > MAX_CHARS) return { error: `At most ${MAX_CHARS} characters per request` };

    return { request: { from, to, texts, segments } };
  }

  /**
   * Translate a validated request. → { translations: { <lang>: { <key>: string | [..] } } }
   * Throws TranslationError (status 502 / 503, code).
   */
  static async translate({ from, to, texts, segments }) {
    if (!this.isEnabled()) {
      throw new TranslationError("AI translation is not configured", { status: 503, code: "TRANSLATE_NOT_CONFIGURED" });
    }

    let byLang = Object.fromEntries(to.map((lang) => [lang, {}]));
    if (segments.length) {
      const input = Object.fromEntries(segments.map((s) => [s.id, s.text]));
      const messages = [
        { role: "system", content: SYSTEM_PROMPT(from, to) },
        { role: "user", content: JSON.stringify({ segments: input }) },
      ];
      const schema = replySchema(to, segments.map((s) => s.id));

      let result = parseReply(await this.complete(messages, schema), to, segments);
      if (result.error) {
        // One retry, told what was wrong.
        result = parseReply(
          await this.complete(
            [
              ...messages,
              {
                role: "user",
                content: `Your previous reply was invalid (${result.error}). Translate again and reply with ONLY the JSON object, with every segment id and every placeholder / link kept.`,
              },
            ],
            schema,
          ),
          to,
          segments,
        );
      }
      if (result.error) {
        console.error(`AI translation failed: malformed model output (${result.error})`);
        throw new TranslationError("The translation service returned an invalid result. Try again.");
      }
      byLang = result.byLang;
    }

    // Back onto the original keys (same array lengths, empty texts stay as sent).
    const segmentAt = new Map(segments.map((s) => [`${s.key}\u0000${s.index ?? ""}`, s.id]));
    const pick = (lang, key, index, original) => {
      const id = segmentAt.get(`${key}\u0000${index ?? ""}`);
      return id ? byLang[lang][id] : original;
    };
    const translations = {};
    to.forEach((lang) => {
      const out = {};
      Object.entries(texts).forEach(([key, value]) => {
        out[key] = Array.isArray(value)
          ? value.map((item, index) => pick(lang, key, index, item))
          : pick(lang, key, null, value);
      });
      translations[lang] = out;
    });
    return { translations };
  }

  /** One chat completion → the reply text. Throws TranslationError on HTTP / network errors. */
  static async complete(messages, schema) {
    const { apiKey, model, referer, title } = config.openRouter;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (referer) headers["HTTP-Referer"] = referer;
    if (title) headers["X-OpenRouter-Title"] = title;

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          response_format: {
            type: "json_schema",
            json_schema: { name: "translations", strict: true, schema },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error?.name === "TimeoutError" ? "timed out" : "network error";
      console.error(`AI translation failed: ${reason}`);
      throw new TranslationError(
        reason === "timed out" ? "The translation service timed out. Try fewer texts." : "Could not reach the translation service",
      );
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch (_error) {
      payload = null;
    }
    if (!res.ok || payload?.error) {
      // Status + the provider's short message only (never the texts or the key).
      const detail = String(payload?.error?.message || "").slice(0, 200);
      console.error(`AI translation failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
      throw new TranslationError("The translation service could not translate the texts. Try again.");
    }
    const content = payload?.choices?.[0]?.message?.content;
    // Some providers return content parts.
    if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
    return content;
  }
}

export { TranslationService, TranslationError };
