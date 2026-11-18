import type { Event } from 'nostr-tools';
import { isNewerEvent } from './event-version';
import { normalizeRelayUrl } from './relay-url';

export const COMMAND_KIND = 31992;
export type Command = { event: Event; command: string; title: string; description: string; args: string[][]; scopes: string[] };
export type CommandContext = { pubkey: string; kind: number; tags: string[][]; relays?: string[] };
const ARG_TYPES = new Set(['pubkey', 'event', 'address', 'relay', 'number', 'bool', 'enum', 'word', 'text']);

function scopeGroup(scope: string): string | null {
  if (/^kind:\d+$/.test(scope) && Number(scope.slice(5)) <= 65535) return 'kind';
  if (/^author:[a-f0-9]{64}$/.test(scope)) return 'author';
  if (/^relay:wss?:\/\//.test(scope)) {
    try { const url = new URL(scope.slice(6)); if (url.hostname && !url.username && !url.password && !url.hash) return 'relay'; } catch { /* Invalid constraint. */ }
  }
  if (/^tag:[^:]+(?::.*)?$/.test(scope)) return scope.split(':').slice(0, 2).join(':');
  return null;
}

/** Unknown constraints fail closed, rather than suggesting an out-of-scope command. */
export function commandInScope(command: Command, context: CommandContext): boolean {
  const groups = new Map<string, boolean>();
  for (const scope of command.scopes) {
    const group = scopeGroup(scope);
    if (!group) return false;
    const value = scope.slice(scope.indexOf(':') + 1);
    let matches = false;
    if (group === 'kind') matches = context.kind === Number(value);
    else if (group === 'author') matches = context.pubkey === value;
    else if (group === 'relay') matches = (context.relays ?? []).some(relay => normalizeRelayUrl(relay) === normalizeRelayUrl(value));
    else {
      const colon = value.indexOf(':');
      const name = colon < 0 ? value : value.slice(0, colon);
      const expected = colon < 0 ? undefined : value.slice(colon + 1);
      matches = context.tags.some(tag => tag[0] === name && (expected === undefined ? !!tag[1] : tag[1] === expected));
    }
    groups.set(group, (groups.get(group) ?? false) || matches);
  }
  return [...groups.values()].every(Boolean);
}

/** Input events have already passed signature verification at the discovery boundary. */
export function parseCommand(event: Event): Command | null {
  if (event.kind !== COMMAND_KIND) return null;
  const one = (name: string) => {
    const tags = event.tags.filter(tag => tag[0] === name);
    return tags.length === 1 && tags[0].length === 2 ? tags[0][1] : undefined;
  };
  const command = one('command'), title = one('title'), description = one('description');
  const identifiers = event.tags.filter(tag => tag[0] === 'd');
  if (identifiers.length > 1 || (identifiers.length === 1 && identifiers[0].length !== 2)) return null;
  if (!command || command.startsWith('/') || /[\s@\x00-\x1f\x7f]/u.test(command) || !title?.trim() || !description?.trim()) return null;
  const args = event.tags.filter(tag => tag[0] === 'arg');
  const names = new Set<string>();
  let optional = 0, text = 0;
  for (const [index, arg] of args.entries()) {
    if (arg.length < 5 || !arg[1] || names.has(arg[1]) || !ARG_TYPES.has(arg[2]) || !['required', 'optional'].includes(arg[3])) return null;
    names.add(arg[1]);
    if (arg[3] === 'optional') optional++;
    else if (optional) return null;
    if (arg[2] === 'text') { text++; if (index !== args.length - 1) return null; }
    if (arg[2] === 'enum') {
      if (arg.length < 6 || arg.slice(5).some(choice => !choice) || new Set(arg.slice(5)).size !== arg.length - 5) return null;
    } else if (arg.length > 5) return null;
  }
  if (optional > 1 || text > 1) return null;
  const scopeTags = event.tags.filter(tag => tag[0] === 's');
  if (scopeTags.some(tag => tag.length !== 2 || !scopeGroup(tag[1]))) return null;
  return { event, command, title, description, args, scopes: scopeTags.map(tag => tag[1]) };
}

/** Retain invalid replacements too: they retire older valid definitions. */
export function mergeCommandEvents(events: Event[]): Event[] {
  const latest = new Map<string, Event>();
  const deletions = new Map<string, Event>();
  for (const event of events) {
    if (event.kind === COMMAND_KIND) {
      const key = `${event.pubkey}:${event.tags.find(tag => tag[0] === 'd')?.[1] ?? ''}`;
      const old = latest.get(key);
      if (!old || isNewerEvent(event, old)) latest.set(key, event);
    } else if (event.kind === 5) {
      for (const tag of event.tags) {
        if (!['a', 'e'].includes(tag[0]) || !tag[1]) continue;
        if (tag[0] === 'a' && !tag[1].startsWith(`${COMMAND_KIND}:${event.pubkey}:`)) continue;
        const key = `${event.pubkey}:${tag[0]}:${tag[1]}`;
        const old = deletions.get(key);
        if (!old || isNewerEvent(event, old)) deletions.set(key, event);
      }
    }
  }
  return [...latest.values(), ...new Map([...deletions.values()].map(event => [event.id, event])).values()];
}

export function availableCommands(events: Event[], context: CommandContext): Command[] {
  const merged = mergeCommandEvents(events);
  const deletedIds = new Set<string>();
  const deletedAddresses = new Map<string, number>();
  for (const event of merged) {
    if (event.kind !== 5) continue;
    for (const tag of event.tags) {
      if (tag[0] === 'e') deletedIds.add(`${event.pubkey}:${tag[1]}`);
      else if (tag[0] === 'a' && tag[1]?.startsWith(`${COMMAND_KIND}:${event.pubkey}:`)) {
        deletedAddresses.set(tag[1], Math.max(deletedAddresses.get(tag[1]) ?? -1, event.created_at));
      }
    }
  }
  return merged.flatMap(event => {
    const command = parseCommand(event);
    if (!command) return [];
    const address = `${COMMAND_KIND}:${event.pubkey}:${event.tags.find(tag => tag[0] === 'd')?.[1] ?? ''}`;
    const deleted = deletedIds.has(`${event.pubkey}:${event.id}`) ||
      (deletedAddresses.get(address) ?? -1) >= event.created_at;
    return !deleted && commandInScope(command, context) ? [command] : [];
  }).sort((a, b) => a.command.localeCompare(b.command) || a.event.id.localeCompare(b.event.id));
}

export function commandQuery(value: string): string | null {
  return /^\/(?!\/)[^\s@]*$/u.test(value) ? value.slice(1) : null;
}
