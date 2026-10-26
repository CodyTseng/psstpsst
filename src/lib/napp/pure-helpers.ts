import { nip19, generateSecretKey, getPublicKey, finalizeEvent, type EventTemplate } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/** These helpers execute inside the application; throwaway secret keys never enter host RPC. */
export function install(napp: Record<string, any>) {
  const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  napp.nip19 = { decode: nip19.decode, npubEncode: nip19.npubEncode, noteEncode: nip19.noteEncode,
    neventEncode: nip19.neventEncode, naddrEncode: nip19.naddrEncode };
  napp.fx = {
    isHex64: hex,
    parseCoordinate(value: unknown) {
      if (typeof value !== 'string') return null;
      const [kind, pubkey, ...identifier] = value.split(':');
      return value.split(':').length >= 3 && Number.isInteger(Number(kind)) && hex(pubkey)
        ? { kind: Number(kind), pubkey, identifier: identifier.join(':') } : null;
    },
    formatCoordinate: (value: {kind: number; pubkey: string; identifier: string}) => `${value.kind}:${value.pubkey}:${value.identifier}`,
    satsFromBolt11(value: unknown) {
      if (typeof value !== 'string') return null;
      const input = value.trim().toLowerCase(), divider = input.lastIndexOf('1');
      const match = /^ln(?:bc|tbs?|bcrt|sb)(\d*)([munp]?)$/.exec(input.slice(0, divider));
      if (divider < 0 || !match) return null;
      if (!match[1]) return 0;
      const factor = ({m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12} as Record<string, number>)[match[2]] ?? 1;
      const sats = Math.round(Number(match[1]) * factor * 1e8);
      return Number.isSafeInteger(sats) ? sats : null;
    },
  };
  const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  napp.utils.generateKey = async () => { await yieldTask(); const secret = generateSecretKey(); try {
    return { sk: bytesToHex(secret), pk: getPublicKey(secret) };
  } finally { secret.fill(0); } };
  napp.utils.signWithKey = async (event: EventTemplate, key: string) => {
    if (!hex(key) || JSON.stringify(event).length > 256 * 1024) throw new Error('invalid-signing-input');
    await yieldTask();
    const secret = hexToBytes(key);
    try { return finalizeEvent(event, secret); } finally { secret.fill(0); }
  };
}
