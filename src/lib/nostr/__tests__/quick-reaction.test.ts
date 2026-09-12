import {
  normalizeStoredQuickReactions,
  quickReactionKey,
} from '../quick-reaction';

describe('quick reactions', () => {
  test('loads the legacy Unicode-only preference format', () => {
    expect(normalizeStoredQuickReactions(['👍', '❤️'])).toEqual(['👍', '❤️']);
  });

  test('loads and identifies custom emoji by shortcode and URL', () => {
    const stored = [
      '👍',
      { shortcode: 'party', url: 'https://cdn.example/party.png' },
    ];

    expect(normalizeStoredQuickReactions(stored)).toEqual(stored);
    expect(quickReactionKey(stored[1] as typeof stored[1])).toBe(
      quickReactionKey({
        shortcode: 'PARTY',
        url: 'https://cdn.example/party.png',
        setAddress: `30030:${'a'.repeat(64)}:party-pack`,
      }),
    );
  });

  test('rejects malformed persisted custom emoji', () => {
    expect(
      normalizeStoredQuickReactions([
        { shortcode: 'bad shortcode', url: 'javascript:alert(1)' },
      ]),
    ).toBeNull();
  });
});
