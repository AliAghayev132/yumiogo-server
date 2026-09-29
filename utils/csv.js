/**
 * Minimal CSV writer for admin exports (RFC 4180 quoting).
 *
 * Cells that start with = + - @ (or tab / CR) are prefixed with a quote so a
 * spreadsheet never evaluates user-controlled text as a formula.
 *
 * Usage:
 *   const csv = toCsv(rows, [
 *     { key: "name", label: "Name" },
 *     { label: "Joined", value: (row) => row.createdAt.toISOString() },
 *   ]);
 *   sendCsv(res, "users.csv", csv);
 */

const FORMULA_START = /^[=+\-@\t\r]/;

const cell = (value) => {
  if (value === undefined || value === null) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** rows + [{ label, key? , value?(row) }] → CSV text (with a header row). */
const toCsv = (rows, columns) => {
  const header = columns.map((c) => cell(c.label)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => cell(c.value ? c.value(row) : row[c.key])).join(","),
  );
  return [header, ...lines].join("\r\n");
};

/** Send CSV as a download (UTF-8 BOM so Excel keeps ə/ş/ç intact). */
const sendCsv = (res, filename, csv) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`﻿${csv}`);
};

export { toCsv, sendCsv };
