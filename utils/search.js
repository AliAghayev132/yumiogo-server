import { escapeRegex } from "./escapeRegex.js";

/**
 * Search-text helpers shared by restaurant search, suggestions, menu dishes and
 * place search.
 *
 * foldText() makes Azerbaijani letters match their plain-latin spelling so
 * "seher" finds "Şəhər" and "icheri" finds "İçərişəhər": lowercase, ə→e, ş→s,
 * ç→c, ı/İ→i, ğ→g, ö→o, ü→u, other accents stripped, "sh"/"ch" collapsed to
 * s/c, punctuation → spaces. Stored keys and queries are folded the same way.
 */

const LETTERS = { ə: "e", ş: "s", ç: "c", ı: "i", ğ: "g", ö: "o", ü: "u" };

/** Folded, space-normalised search key ("" for empty input). */
const foldText = (value) =>
  String(value ?? "")
    .replace(/[İI]/g, "i")
    .toLowerCase()
    .replace(/[əşçığöü]/g, (ch) => LETTERS[ch])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Folded query → up to `max` distinct tokens. */
const searchTokens = (value, max = 5) => [
  ...new Set(foldText(value).split(" ").filter(Boolean)),
].slice(0, max);

/** Escaped regex source that matches `token` anywhere / at a word start. */
const containsPattern = (token) => escapeRegex(token);
const wordPrefixPattern = (token) => `(^| )${escapeRegex(token)}`;

/** Does the folded `text` contain every token? */
const matchesAll = (text, tokens) => {
  const folded = foldText(text);
  return tokens.every((t) => folded.includes(t));
};

/** 0..100 closeness of a folded `text` to the folded query (for ranking lists). */
const textScore = (text, query) => {
  const folded = foldText(text);
  const q = foldText(query);
  if (!q || !folded) return 0;
  if (folded === q) return 100;
  if (folded.startsWith(q)) return 80;
  if (folded.includes(` ${q}`)) return 60;
  if (folded.includes(q)) return 40;
  const tokens = q.split(" ");
  return tokens.every((t) => folded.includes(t)) ? 20 : 0;
};

export { foldText, searchTokens, containsPattern, wordPrefixPattern, matchesAll, textScore };
