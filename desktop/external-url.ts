import { normalizeNostrEventUrl } from '../src/lib/nostr/event-url';
import { parseBolt11Invoice } from '../src/services/wallet/bolt11';

export const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'nostrconnect:', 'bunker:']);
const MAX_LIGHTNING_URL_LENGTH = 8 * 1024;

type Dependencies = {
  readNostrEventUrl: () => Promise<string | null>;
  open: (url: string) => Promise<void>;
};

function matchesNostrEventTemplate(value: string, storedTemplate: string): boolean {
  const template = normalizeNostrEventUrl(storedTemplate);
  if (!template) return false;
  const parts = template.split('{id}').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Only the event identifier varies. Repeated placeholders must match the
  // same identifier, and every other part must equal the saved template.
  const pattern = parts[0] + '(?<id>(?:note1|nevent1|naddr1)[a-z0-9]{1,5000})'
    + parts.slice(1).join('\\k<id>');
  return new RegExp(`^${pattern}$`).exec(value)?.[0] === value;
}

function normalizeLightningPaymentUrl(value: string): string | null {
  if (value.length > MAX_LIGHTNING_URL_LENGTH || !value.toLowerCase().startsWith('lightning:')) {
    return null;
  }
  const encodedInvoice = value.slice('lightning:'.length);
  if (
    encodedInvoice !== encodedInvoice.toLowerCase() &&
    encodedInvoice !== encodedInvoice.toUpperCase()
  ) {
    return null;
  }
  try {
    const invoice = parseBolt11Invoice(value).invoice;
    const normalized = `lightning:${invoice}`;
    return value.toLowerCase() === normalized ? normalized : null;
  } catch {
    return null;
  }
}

/** Custom schemes are scoped to a device-configured note URL, never arbitrary content links. */
export async function openExternalUrl(value: string, dependencies: Dependencies): Promise<void> {
  const url = new URL(value);
  if (url.protocol === 'lightning:') {
    const normalized = normalizeLightningPaymentUrl(value);
    if (!normalized) throw new Error('Invalid Lightning payment request');
    await dependencies.open(normalized);
    return;
  }
  if (!EXTERNAL_SCHEMES.has(url.protocol)) {
    const template = await dependencies.readNostrEventUrl();
    if (!template || !matchesNostrEventTemplate(value, template)) {
      throw new Error('External URL does not match the configured note app');
    }
    // Preserve custom URL spelling, including its authority and opaque path.
    await dependencies.open(value);
    return;
  }
  await dependencies.open(url.toString());
}
