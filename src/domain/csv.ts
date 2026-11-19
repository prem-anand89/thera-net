// One place that turns a value into a CSV cell, so every export neutralises spreadsheet formulas the same way.

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * Text safe to open in Excel or Google Sheets. A text value starting with = + - @ (or a tab or carriage return) would run as
 * a formula, so it gets a leading apostrophe. Numbers, and text that is only a number such as "-125.50", stay as they are.
 */
export function neutraliseFormula(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (typeof value === 'number' || PLAIN_NUMBER.test(s)) return s;
  return FORMULA_START.test(s) ? `'${s}` : s;
}

/** A cell always wrapped in quotes, with quotes doubled. */
export function csvQuoted(value: unknown): string {
  return `"${neutraliseFormula(value).replaceAll('"', '""')}"`;
}

/** A cell wrapped in quotes only when it holds a comma, quote or line break. */
export function csvMinimal(value: unknown): string {
  const t = neutraliseFormula(value);
  return /[",\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}
