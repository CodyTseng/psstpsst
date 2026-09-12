import { normalizeNostrEventUrl } from '../src/lib/nostr/event-url';

export const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'nostrconnect:', 'bunker:']);

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

/** Custom schemes are scoped to a device-configured note URL, never arbitrary content links. */
export async function openExternalUrl(value: string, dependencies: Dependencies): Promise<void> {
  const url = new URL(value);
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
