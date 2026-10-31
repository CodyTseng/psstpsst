/** Numeric date patterns use calendar-year, month and day tokens only. */
export const DEFAULT_CUSTOM_DATE_FORMAT = 'YYYY/MM/DD';
export const MAX_CUSTOM_DATE_FORMAT_LENGTH = 40;
const patterns = new Map<string, readonly string[]>();
const TOKENS = new Set(['YYYY', 'YY', 'MM', 'M', 'DD', 'D']);

function compile(pattern: string): readonly string[] | null {
  if (!pattern || pattern.length > MAX_CUSTOM_DATE_FORMAT_LENGTH) return null;
  const cached = patterns.get(pattern);
  if (cached) return cached;
  const parts = pattern.match(/YYYY|YY|MM|M|DD|D|[^A-Za-z0-9\p{Control}\p{Format}]+/gu);
  if (!parts || parts.join('') !== pattern) return null;
  const tokens = parts.filter(part => TOKENS.has(part));
  if (tokens.length !== 3 ||
      tokens.filter(token => token[0] === 'Y').length !== 1 ||
      tokens.filter(token => token[0] === 'M').length !== 1 ||
      tokens.filter(token => token[0] === 'D').length !== 1) return null;
  if (patterns.size >= 32) patterns.clear();
  patterns.set(pattern, parts);
  return parts;
}

/** Reject missing/repeated fields, unknown tokens and invisible control characters. */
export function normalizeCustomDateFormat(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_CUSTOM_DATE_FORMAT_LENGTH) return null;
  const pattern = value.trim();
  return pattern && compile(pattern) ? pattern : null;
}

export function formatCustomDate(date: Date, pattern: string): string {
  const parts = compile(pattern) ?? compile(DEFAULT_CUSTOM_DATE_FORMAT)!;
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());
  const values: Record<string, string> = {
    YYYY: year, YY: year.slice(-2), MM: month.padStart(2, '0'), M: month,
    DD: day.padStart(2, '0'), D: day,
  };
  return parts.map(part => values[part] ?? part).join('');
}
