import { utf8ToBytes } from '@noble/hashes/utils.js';

import i18n, { LANGUAGES } from '@/i18n';
import { PROXIMITY_DEFAULT_NAMES } from '@/i18n/proximity-default-names';

import {
  isValidProximityDisplayName,
  normalizeProximityDisplayName,
  normalizeOrRandomProximityDisplayName,
  PROXIMITY_DISPLAY_NAME_MAX_LENGTH,
  randomProximityDisplayName,
  sanitizeProximityDisplayNameInput,
} from '../proximity-display-name';
import { PROXIMITY_MAX_NAME_BYTES } from '../proximity-protocol';

describe('proximity display names', () => {
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  test('preserves ordinary Unicode names and emoji', () => {
    expect(normalizeProximityDisplayName('  小明 🚀  ')).toBe('小明 🚀');
  });

  test('removes line breaks, control characters, and bidi overrides', () => {
    expect(normalizeProximityDisplayName('Alice\n\u0000\u202eBob')).toBe('AliceBob');
    expect(isValidProximityDisplayName('Alice\nBob')).toBe(false);
  });

  test('limits the name by Unicode code points without splitting surrogate pairs', () => {
    const value = '😀'.repeat(PROXIMITY_DISPLAY_NAME_MAX_LENGTH + 1);
    const sanitized = sanitizeProximityDisplayNameInput(value);

    expect(Array.from(sanitized)).toHaveLength(PROXIMITY_DISPLAY_NAME_MAX_LENGTH);
    expect(sanitized).toBe('😀'.repeat(PROXIMITY_DISPLAY_NAME_MAX_LENGTH));
  });

  test('keeps empty input available for identity-level defaulting', () => {
    expect(normalizeProximityDisplayName('   ')).toBe('');
    expect(isValidProximityDisplayName('')).toBe(false);
  });

  test('generates a LocalSend-style default from independent random bytes', () => {
    const randomBytesSource = jest.fn(() => Uint8Array.of(0, 0));

    const name = randomProximityDisplayName(undefined, randomBytesSource);

    expect(name).toBe('Amber Badger');
    expect(isValidProximityDisplayName(name)).toBe(true);
    expect(randomBytesSource).toHaveBeenCalledWith(2);
  });

  test.each(LANGUAGES)('%s offers 1,024 valid names within display and wire limits', (language) => {
    const vocabulary = PROXIMITY_DEFAULT_NAMES[language];
    expect(vocabulary.adjectives).toHaveLength(32);
    expect(vocabulary.animals).toHaveLength(32);
    const names = new Set<string>();
    for (let adjective = 0; adjective < 32; adjective += 1) {
      for (let animal = 0; animal < 32; animal += 1) {
        names.add(
          randomProximityDisplayName(
            undefined,
            () => Uint8Array.of(adjective, animal),
            language,
          ),
        );
      }
    }

    expect(names.size).toBe(1_024);
    expect([...names].every(isValidProximityDisplayName)).toBe(true);
    expect(Math.max(...[...names].map((name) => Array.from(name).length))).toBeLessThanOrEqual(
      PROXIMITY_DISPLAY_NAME_MAX_LENGTH,
    );
    expect(Math.max(...[...names].map((name) => utf8ToBytes(name).length))).toBeLessThanOrEqual(
      PROXIMITY_MAX_NAME_BYTES,
    );
  });

  test.each([
    ['en-US', 'Amber Badger'],
    ['zh-CN', '快乐的小猫'],
    ['zh-TW', '快樂的小貓'],
    ['ja-JP', '陽気なネコ'],
    ['ko-KR', '행복한 고양이'],
    ['de-DE', 'Fröhlicher Dachs'],
    ['es-ES', 'Tejón alegre'],
    ['fr-FR', 'Blaireau joyeux'],
    ['it-IT', 'Tasso allegro'],
    ['pt_BR', 'Texugo alegre'],
    ['pt-PT', 'Texugo alegre'],
    ['ru-RU', 'Весёлый барсук'],
    ['pl-PL', 'Wesoły borsuk'],
    ['hu-HU', 'Vidám borz'],
    ['tr-TR', 'Neşeli Porsuk'],
    ['ar-SA', 'قط مرح'],
    ['fa-IR', 'گربه شاد'],
    ['hi-IN', 'खुश बिल्ला'],
    ['th-TH', 'แมวร่าเริง'],
    ['unknown', 'Amber Badger'],
  ])('uses native word order and joining for %s', (locale, expected) => {
    expect(randomProximityDisplayName(undefined, () => Uint8Array.of(0, 0), locale)).toBe(expected);
  });

  test('uses the current app language for new names while preserving saved names', async () => {
    const source = () => Uint8Array.of(0, 0);
    const savedName = randomProximityDisplayName(undefined, source);

    await i18n.changeLanguage('zh');
    expect(randomProximityDisplayName(undefined, source)).toBe('快乐的小猫');
    expect(normalizeOrRandomProximityDisplayName(savedName)).toBe('Amber Badger');
    expect(normalizeOrRandomProximityDisplayName('  My Phone  ')).toBe('My Phone');
    expect(normalizeOrRandomProximityDisplayName('   ')).toMatch(/的/);

    await i18n.changeLanguage('ja');
    expect(randomProximityDisplayName(undefined, source)).toBe('陽気なネコ');
  });

  test.each(LANGUAGES)('%s avoids the excluded name even after repeated collisions', (language) => {
    const source = jest.fn(() => Uint8Array.of(255, 255));
    const excluded = randomProximityDisplayName(undefined, source, language);
    source.mockClear();

    const result = randomProximityDisplayName(excluded, source, language);

    expect(result).not.toBe(excluded);
    expect(result).toBe(randomProximityDisplayName(undefined, () => Uint8Array.of(31, 0), language));
    expect(source).toHaveBeenCalledTimes(4);
  });

  test('preserves a custom name and fills an empty name randomly', () => {
    expect(normalizeOrRandomProximityDisplayName('  My Phone  ')).toBe('My Phone');
    expect(isValidProximityDisplayName(normalizeOrRandomProximityDisplayName('   '))).toBe(true);
  });

  test('rerolls when the generated name matches the excluded name', () => {
    const entropy = [Uint8Array.of(0, 0), Uint8Array.of(31, 31)];
    const randomBytesSource = jest.fn(() => entropy.shift() ?? Uint8Array.of(31, 31));

    expect(randomProximityDisplayName('Amber Badger', randomBytesSource)).toBe('Wise Yak');
    expect(randomBytesSource).toHaveBeenCalledTimes(2);
  });

  test('rejects insufficient random entropy', () => {
    expect(() => randomProximityDisplayName(undefined, () => Uint8Array.of(1))).toThrow(
      'Two random bytes are required',
    );
  });
});
