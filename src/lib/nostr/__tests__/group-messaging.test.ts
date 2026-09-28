import {
  bootstrapMembers,
  firstGroupId,
  generateGroupId,
  groupConversationKey,
  initialGroupMembers,
  isFinalizedNetworkEvent,
  parseGroupAction,
  parseGroupSubject,
  validMemberPubkeys,
} from '../group-messaging';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('group messaging helpers', () => {
  test('uses only the first h tag and enforces UTF-8 byte limits', () => {
    expect(firstGroupId([['h', 'first'], ['h', 'second']])).toBe('first');
    expect(firstGroupId([['h'], ['h', 'second']])).toBeNull();
    expect(firstGroupId([['h', '']])).toBeNull();
    expect(firstGroupId([['h', '界'.repeat(85)]])).toBe('界'.repeat(85));
    expect(firstGroupId([['h', '界'.repeat(86)]])).toBeNull();
  });

  test('hashes arbitrary group ids into route-safe conversation keys', () => {
    expect(groupConversationKey('family / 家人')).toMatch(/^group:[0-9a-f]{64}$/);
    expect(groupConversationKey('family / 家人')).toBe(groupConversationKey('family / 家人'));
    expect(() => groupConversationKey('')).toThrow('Invalid group id');
  });

  test('generates 32-byte lowercase hexadecimal ids', () => {
    expect(generateGroupId(() => Uint8Array.from({ length: 32 }, (_, i) => i))).toBe(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    );
  });

  test('filters, deduplicates, and sorts member pubkeys', () => {
    const tags = [['p', B], ['p', 'BAD'], ['p', A], ['p', B]];
    expect(validMemberPubkeys(tags)).toEqual([A, B]);
    expect(bootstrapMembers(B, [['p', A], ['p', 'BAD']])).toEqual([A, B]);
  });

  test('requires two other people only at local group creation', () => {
    const C = 'c'.repeat(64);
    expect(initialGroupMembers(A, [B, C, B])).toEqual([A, B, C]);
    expect(() => initialGroupMembers(A, [B])).toThrow('at least two');
    expect(() => initialGroupMembers(A, [B, 'BAD'])).toThrow('Invalid group member');
  });

  test('parses only the first action tag with exact shapes', () => {
    expect(parseGroupAction([['action', 'create'], ['action', 'wat']])).toEqual({
      status: 'valid',
      action: { type: 'create' },
    });
    expect(parseGroupAction([['action', 'create', A]])).toEqual({ status: 'invalid' });
    expect(parseGroupAction([['action', 'invite', A]])).toEqual({
      status: 'valid',
      action: { type: 'invite', memberPubkey: A },
    });
    expect(parseGroupAction([['action', 'remove', A, B]])).toEqual({ status: 'invalid' });
    expect(parseGroupAction([['action', 'wat']])).toEqual({ status: 'invalid' });
  });

  test('normalizes subjects and rejects overlong rename actions', () => {
    expect(parseGroupSubject([])).toEqual({ status: 'absent' });
    expect(parseGroupSubject([['subject']])).toEqual({ status: 'valid', name: null });
    expect(parseGroupSubject([['subject', '  Friends  ']])).toEqual({
      status: 'valid',
      name: 'Friends',
    });
    expect(parseGroupSubject([['subject', '🫡'.repeat(81)]])).toEqual({ status: 'invalid' });
    expect(parseGroupAction([['action', 'rename'], ['subject', '🫡'.repeat(81)]])).toEqual({
      status: 'invalid',
    });
  });

  test('finalizes only complete account history before the open cursor second', () => {
    expect(isFinalizedNetworkEvent({ orderAt: 9_999 }, 10, 0)).toBe(true);
    expect(isFinalizedNetworkEvent({ orderAt: 10_000 }, 10, 0)).toBe(false);
    expect(isFinalizedNetworkEvent({ orderAt: 9_999 }, 10, 5)).toBe(false);
  });
});
