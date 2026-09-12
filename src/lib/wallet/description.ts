const PLAIN_TEXT_TYPE = 'text/plain';
const IDENTIFIER_TEXT_TYPE = 'text/identifier';
const DIRECT_TEXT_FIELDS = ['description', 'comment', 'memo', 'message', 'text', 'title', 'label', 'name'];
const NESTED_TEXT_FIELDS = ['metadata', 'payer_data'];

export function walletDescriptionText(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsed = parseJsonValue(trimmed);
    if (parsed.ok) {
      if (typeof parsed.value === 'string') return walletDescriptionText(parsed.value);
      return structuredDescriptionText(parsed.value);
    }
    return trimmed;
  }

  return structuredDescriptionText(value);
}

function structuredDescriptionText(value: unknown): string | null {
  if (Array.isArray(value)) return arrayDescriptionText(value);
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const typedText = walletDescriptionText(record[PLAIN_TEXT_TYPE]) ?? walletDescriptionText(record[IDENTIFIER_TEXT_TYPE]);
  if (typedText) return typedText;

  for (const field of DIRECT_TEXT_FIELDS) {
    const text = walletDescriptionText(record[field]);
    if (text) return text;
  }

  for (const field of NESTED_TEXT_FIELDS) {
    const text = structuredDescriptionText(record[field]);
    if (text) return text;
  }

  return null;
}

function arrayDescriptionText(value: unknown[]): string | null {
  return typedMetadataText(value, PLAIN_TEXT_TYPE) ?? typedMetadataText(value, IDENTIFIER_TEXT_TYPE) ?? nestedArrayText(value);
}

function typedMetadataText(value: unknown[], mime: string): string | null {
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2 || entry[0] !== mime) continue;
    const text = walletDescriptionText(entry[1]);
    if (text) return text;
  }
  return null;
}

function nestedArrayText(value: unknown[]): string | null {
  for (const entry of value) {
    const text = structuredDescriptionText(entry);
    if (text) return text;
  }
  return null;
}

function parseJsonValue(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}
