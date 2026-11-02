import { bech32 } from '@scure/base';
import { nip19, type Event, type EventTemplate } from 'nostr-tools';
import { publicUrl } from './protocol';
import type { ApplicationNetwork } from '@/services/applications/network';
import { PublicIdentityData, followedPubkeys, newerPublicEvent, rememberPublishedIdentity } from '@/services/applications/public-identity';

const HEX = /^[a-f0-9]{64}$/i;
const reasons = new Set(['nudity', 'malware', 'profanity', 'illegal', 'spam', 'impersonation', 'other']);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
type Message = Record<string, any>;
/** Adopt only a revision returned by the trusted signer after its own approval. */
export type CommonCheck = (() => void) & { authorized?: (revision: number) => void };
type FollowState = { users: number; tail: Promise<void>; latest?: Event };
const followsByAccount = new Map<string, FollowState>();

function string(value: unknown, limit = 5000): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('invalid-request');
  return value;
}
function hex(value: unknown): string {
  if (typeof value !== 'string' || !HEX.test(value)) throw new Error('invalid-identifier');
  return value.toLowerCase();
}
function kind(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 65535) throw new Error('invalid-kind');
  return value as number;
}
function hints(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) throw new Error('invalid-relays');
  return value.map(url => publicUrl(string(url), true));
}
function decode(value: unknown): Message {
  const code = string(value).replace(/^nostr:/i, '');
  // Secret-key encodings are outside this public-only contract.
  if (/^nsec1/i.test(code)) throw new Error('invalid-identifier');
  if (/^nrelay1/i.test(code)) {
    const bytes = bech32.fromWords(bech32.decode(code as `${string}1${string}`, 5000).words);
    let relay: string | undefined;
    for (let i = 0; i < bytes.length;) {
      if (i + 2 > bytes.length) throw new Error('invalid-identifier');
      const type = bytes[i++], size = bytes[i++];
      if (i + size > bytes.length) throw new Error('invalid-identifier');
      if (type === 0 && relay === undefined) relay = publicUrl(decoder.decode(bytes.slice(i, i + size)), true);
      i += size;
    }
    if (!relay) throw new Error('invalid-identifier');
    return { ok: true, nip19Type: 'nrelay', relay };
  }
  const result = nip19.decode(code);
  switch (result.type) {
    case 'npub': case 'note': return { ok: true, nip19Type: result.type, hex: result.data };
    case 'nprofile': return { ok: true, nip19Type: result.type, ...result.data };
    case 'nevent': return { ok: true, nip19Type: result.type, eventId: result.data.id, relays: result.data.relays, author: result.data.author, kind: result.data.kind };
    case 'naddr': return { ok: true, nip19Type: result.type, ...result.data };
    default: throw new Error('invalid-identifier');
  }
}
function encode(input: Message): Message {
  if (!input || typeof input !== 'object') throw new Error('invalid-request');
  let value: string;
  switch (input.type) {
    case 'npub': value = nip19.npubEncode(hex(input.hex)); break;
    case 'note': value = nip19.noteEncode(hex(input.hex)); break;
    case 'nprofile': value = nip19.nprofileEncode({ pubkey: hex(input.pubkey), relays: hints(input.relays) }); break;
    case 'nevent': value = nip19.neventEncode({ id: hex(input.eventId), relays: hints(input.relays), author: input.author === undefined ? undefined : hex(input.author), kind: input.kind === undefined ? undefined : kind(input.kind) }); break;
    case 'naddr': value = nip19.naddrEncode({ identifier: string(input.identifier, 255), pubkey: hex(input.pubkey), kind: kind(input.kind), relays: hints(input.relays) }); break;
    case 'nrelay': {
      const url = encoder.encode(publicUrl(string(input.relay), true));
      if (url.length > 255) throw new Error('invalid-identifier');
      value = bech32.encode('nrelay', bech32.toWords(Uint8Array.from([0, url.length, ...url])), 5000);
      break;
    }
    default: throw new Error('invalid-identifier');
  }
  return { ok: true, value, nip19Type: input.type };
}
function pubkey(value: unknown): string {
  if (typeof value === 'string' && HEX.test(value)) return hex(value);
  const result = decode(value);
  if (result.nip19Type === 'npub') return result.hex;
  if (result.nip19Type === 'nprofile') return result.pubkey;
  throw new Error('invalid-pubkey');
}
/** NAP-COMMON builds public social events; the runtime retains all signer authority. */
export class CommonActions {
  private state: FollowState;
  constructor(private options: {
    account: string;
    network: ApplicationNetwork;
    identity: PublicIdentityData;
    publish(template: EventTemplate, current: CommonCheck): Promise<Message>;
  }) {
    this.state = followsByAccount.get(options.account) ?? { users: 0, tail: Promise.resolve() };
    this.state.users++;
    followsByAccount.set(options.account, this.state);
  }
  close() {
    if (--this.state.users === 0) {
      const state = this.state;
      void state.tail.finally(() => { if (!state.users && followsByAccount.get(this.options.account) === state) followsByAccount.delete(this.options.account); });
    }
  }
  async handle(op: string, message: Message, current: CommonCheck): Promise<Message> {
    current();
    if (op === 'encodeNip19') return encode(message.input);
    if (op === 'decodeNip19') return decode(message.value);
    if (op === 'getProfile') {
      const key = pubkey(message.target);
      const { event, metadata: profile } = await this.options.identity.profile(message.target);
      current();
      if (!event) return { ok: true, pubkey: key, profile: null };
      return { ok: true, pubkey: key, profile: { ...profile, ...(typeof profile.display_name === 'string' ? { displayName: profile.display_name } : {}) }, result: { event } };
    }
    if (op === 'follows') {
      const event = newerPublicEvent(await this.options.identity.follows(this.options.account), this.state.latest);
      current();
      return { ok: true, pubkeys: await followedPubkeys(event, current) };
    }
    if (op === 'follow' || op === 'unfollow') {
      if (!Array.isArray(message.pubkeys) || !message.pubkeys.length || message.pubkeys.length > 1000) throw new Error('invalid-pubkeys');
      const targets = new Set<string>(message.pubkeys.map(pubkey));
      const task = this.state.tail.then(async () => {
        current();
        const previous = await this.followList(current);
        const tags: string[][] = [], existing = new Set<string>();
        const original = previous?.tags ?? [];
        for (let i = 0; i < original.length; i++) {
          if (i % 1024 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); current(); }
          const tag = original[i];
          if (tag[0] === 'p') existing.add(tag[1]?.toLowerCase());
          if (!(op === 'unfollow' && tag[0] === 'p' && targets.has(tag[1]?.toLowerCase()))) tags.push([...tag]);
        }
        if (op === 'follow') for (const target of targets) if (!existing.has(target)) tags.push(['p', target]);
        current();
        const published = await this.options.publish({ kind: 3, content: previous?.content ?? '', tags, created_at: Math.max(Math.floor(Date.now() / 1000), (previous?.created_at ?? 0) + 1) }, current);
        if (published.event && (published.ok || Object.values(published.relays ?? {}).some(Boolean))) {
          this.state.latest = newerPublicEvent(this.state.latest, published.event) ?? undefined;
          rememberPublishedIdentity(this.options.network, published.event);
        }
        current();
        return published;
      });
      this.state.tail = task.then(() => {}, () => {});
      return task;
    }
    if (op === 'react') {
      const id = hex(message.targetEventId), reaction = string(message.reaction, 1024);
      const target = await this.event(id, undefined, current);
      const tags = [['e', id, '', target.pubkey], ['p', target.pubkey], ['k', String(target.kind)]];
      if (target.kind >= 30000 && target.kind < 40000) tags.push(['a', `${target.kind}:${target.pubkey}:${target.tags.find(tag => tag[0] === 'd')?.[1] ?? ''}`]);
      if (message.customEmojiHref !== undefined) {
        const match = /^:([a-zA-Z0-9_]+):$/.exec(reaction);
        if (!match) throw new Error('invalid-reaction');
        tags.push(['emoji', match[1], publicUrl(string(message.customEmojiHref))]);
      }
      current();
      return this.options.publish({ kind: 7, content: reaction, tags, created_at: Math.floor(Date.now() / 1000) }, current);
    }
    if (op === 'report') {
      if (!reasons.has(message.reason)) throw new Error('invalid-report-reason');
      const target = message.target;
      if (!target || !['event', 'pubkey'].includes(target.type)) throw new Error('invalid-report-target');
      const content = string(message.text, 65536);
      const relay = target.relay === undefined ? undefined : publicUrl(string(target.relay), true);
      let tags: string[][];
      if (target.type === 'pubkey') tags = [['p', pubkey(target.pubkey), message.reason]];
      else {
        const id = hex(target.id);
        const author = target.pubkey === undefined ? (await this.event(id, relay, current)).pubkey : hex(target.pubkey);
        tags = [['e', id, message.reason], ['p', author]];
      }
      current();
      return this.options.publish({ kind: 1984, content, tags, created_at: Math.floor(Date.now() / 1000) }, current);
    }
    throw new Error('unsupported');
  }
  private async followList(current: () => void): Promise<Event | null> {
    const event = await this.options.identity.follows(this.options.account, { fresh: true, requireComplete: true });
    current();
    return newerPublicEvent(event, this.state.latest);
  }
  private async event(id: string, relay: string | undefined, current: () => void): Promise<Event> {
    const routes = await this.options.network.routes([this.options.account], 'read');
    current();
    const result = await this.options.network.query([...new Set([...routes, ...(relay ? [relay] : [])])], [{ ids: [id], limit: 1 }]);
    current();
    const event = result.events.find(event => event.id === id);
    if (!event) throw new Error(result.error ?? (result.incomplete ? 'network-error' : 'not-found'));
    return event;
  }
}
