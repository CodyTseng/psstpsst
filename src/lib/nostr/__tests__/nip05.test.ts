import {
  isNip05Identifier,
  normalizeNip05Identifier,
} from '@/lib/nostr/nip05';

describe('normalizeNip05Identifier', () => {
  it('normalizes explicit NIP-05 identifiers with supported local-part characters', () => {
    expect(normalizeNip05Identifier(' alice.smith_01-test@Example.COM ')).toBe(
      'alice.smith_01-test@example.com',
    );
    expect(normalizeNip05Identifier('a._-@example.com')).toBe('a._-@example.com');
  });

  it.each([
    'example.com',
    '@example.com',
    'alice@localhost',
    'alice@@example.com',
    'Alice@example.com',
    'alice+tag@example.com',
    'café@example.com',
    'alice smith@example.com',
  ])('rejects %s', (identifier) => {
    expect(normalizeNip05Identifier(identifier)).toBeNull();
    expect(isNip05Identifier(identifier)).toBe(false);
  });
});
