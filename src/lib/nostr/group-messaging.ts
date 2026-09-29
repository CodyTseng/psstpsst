import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import type { MessageOrderKey } from './message-order';

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const GENERATED_GROUP_ID_BYTES = 32;
const MAX_GROUP_ID_BYTES = 256;
const MAX_GROUP_NAME_CODE_POINTS = 80;

export type GroupAction =
  | { type: 'create' }
  | { type: 'invite'; memberPubkey: string }
  | { type: 'remove'; memberPubkey: string }
  | { type: 'rename'; name: string | null };

export type ParsedGroupAction =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'valid'; action: GroupAction };

export type ParsedSubject =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'valid'; name: string | null };

export function isValidMemberPubkey(value: unknown): value is string {
  return typeof value === 'string' && PUBKEY_PATTERN.test(value);
}

export function validMemberPubkeys(tags: readonly string[][]): string[] {
  const pubkeys = new Set<string>();
  for (const tag of tags) {
    if (tag[0] === 'p' && isValidMemberPubkey(tag[1])) pubkeys.add(tag[1]);
  }
  return [...pubkeys].sort();
}

export function initialGroupMembers(
  accountPubkey: string,
  selectedPubkeys: readonly string[],
): string[] {
  if (!isValidMemberPubkey(accountPubkey)) throw new Error('Invalid account pubkey');
  const selected = [...new Set(selectedPubkeys)];
  if (selected.some((pubkey) => !isValidMemberPubkey(pubkey))) {
    throw new Error('Invalid group member pubkey');
  }
  const others = selected.filter((pubkey) => pubkey !== accountPubkey);
  if (others.length < 2) throw new Error('A group requires at least two other members');
  return [...others, accountPubkey].sort();
}

/** Return the first h value when it is a usable group id. Later h tags never win. */
export function firstGroupId(tags: readonly string[][]): string | null {
  const tag = tags.find((candidate) => candidate[0] === 'h');
  return isValidGroupId(tag?.[1]) ? tag[1] : null;
}

export function isValidGroupId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const byteLength = utf8ToBytes(value).length;
  return byteLength >= 1 && byteLength <= MAX_GROUP_ID_BYTES;
}

export function groupConversationKey(groupId: string): string {
  if (!isValidGroupId(groupId)) throw new Error('Invalid group id');
  const bytes = utf8ToBytes(groupId);
  return `group:${bytesToHex(sha256(bytes))}`;
}

export function generateGroupId(random: (length: number) => Uint8Array = randomBytes): string {
  const value = random(GENERATED_GROUP_ID_BYTES);
  if (value.length !== GENERATED_GROUP_ID_BYTES) {
    throw new Error('Group id entropy source returned the wrong byte length');
  }
  return bytesToHex(value);
}

export function parseGroupSubject(tags: readonly string[][]): ParsedSubject {
  const tag = tags.find((candidate) => candidate[0] === 'subject');
  if (!tag) return { status: 'absent' };
  const name = (tag[1] ?? '').trim();
  if ([...name].length > MAX_GROUP_NAME_CODE_POINTS) return { status: 'invalid' };
  return { status: 'valid', name: name || null };
}

export function parseGroupAction(tags: readonly string[][]): ParsedGroupAction {
  const tag = tags.find((candidate) => candidate[0] === 'action');
  if (!tag) return { status: 'none' };

  if (tag.length === 2 && tag[1] === 'create') {
    return { status: 'valid', action: { type: 'create' } };
  }
  if (tag.length === 3 && tag[1] === 'invite' && isValidMemberPubkey(tag[2])) {
    return { status: 'valid', action: { type: 'invite', memberPubkey: tag[2] } };
  }
  if (tag.length === 3 && tag[1] === 'remove' && isValidMemberPubkey(tag[2])) {
    return { status: 'valid', action: { type: 'remove', memberPubkey: tag[2] } };
  }
  if (tag.length === 2 && tag[1] === 'rename') {
    const subject = parseGroupSubject(tags);
    if (subject.status === 'valid') {
      return { status: 'valid', action: { type: 'rename', name: subject.name } };
    }
  }
  return { status: 'invalid' };
}

export function bootstrapMembers(authorPubkey: string, tags: readonly string[][]): string[] {
  const members = validMemberPubkeys(tags);
  if (isValidMemberPubkey(authorPubkey) && !members.includes(authorPubkey)) {
    members.push(authorPubkey);
    members.sort();
  }
  return members;
}

/**
 * Sync cursors have second precision. Keep the cursor's own second open so an
 * action authored after the query snapshot in that same second is not rejected.
 */
export function isFinalizedNetworkEvent(
  event: Pick<MessageOrderKey, 'orderAt'>,
  forwardSinceSeconds: number | null,
  backwardUntilSeconds: number | null,
): boolean {
  return (
    backwardUntilSeconds === 0 &&
    forwardSinceSeconds != null &&
    event.orderAt < forwardSinceSeconds * 1000
  );
}
