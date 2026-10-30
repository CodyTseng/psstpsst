import {
  ACCENTS, ACCENT_KEYS, customAccentTones, isCustomAccent, normalizeCustomAccent,
  parseAccent, presetAccentTones, resolveAccentPair, serializeAccent,
} from '../accents';

it('normalizes short, bare and mixed-case RGB colours', () => {
  expect(normalizeCustomAccent(' #aBc ')).toBe('#AABBCC');
  expect(normalizeCustomAccent('a1b2c3')).toBe('#A1B2C3');
  expect(normalizeCustomAccent('#000000')).toBe('#000000');
});

it.each(['', '#12', '#12345', '#12345678', 'red', 'rgb(0,0,0)', '#GG0000', 'toString', '__proto__'])(
  'rejects malformed colour %s', (input) => {
    expect(normalizeCustomAccent(input)).toBeNull();
    expect(parseAccent(input)).toBeNull();
  },
);

it('keeps existing preset and single-HEX preferences compatible', () => {
  for (const key of ACCENT_KEYS) expect(parseAccent(key)).toBe(key);
  expect(parseAccent('#abc')).toBe('#AABBCC');
  expect(parseAccent(null)).toBeNull();
  expect(isCustomAccent('blue')).toBe(false);
  expect(isCustomAccent('#123456')).toBe(true);
});

it('normalizes and serializes a sparse per-mode configuration without making the missing mode explicit', () => {
  const normalized = parseAccent({ dark: { color: '#aBc', foreground: 'black' } });
  expect(normalized).toEqual({ dark: { color: '#AABBCC', foreground: 'black' } });
  const serialized = serializeAccent(normalized!);
  expect(parseAccent(serialized)).toEqual(normalized);
  expect(serialized).not.toContain('light');
  expect(serializeAccent('teal')).toBe('teal');
});

it.each([{}, [], { light: null }, { light: '#abc' }, { light: { color: '#xyz' } },
  { light: { color: '#abcdef', foreground: 'red' } }, '{broken'])(
  'rejects malformed paired settings %j', (value) => expect(parseAccent(value)).toBeNull(),
);

it.each(ACCENT_KEYS)('uses white foregrounds for preset %s in both modes without changing its colours', (key) => {
  for (const mode of ['light', 'dark'] as const) {
    expect(presetAccentTones(key, mode)).toMatchObject({
      ...ACCENTS[key][mode], accentForeground: '#FFFFFF',
      accentForegroundMuted: 'rgba(255,255,255,0.8)', accentForegroundSoft: 'rgba(255,255,255,0.18)',
    });
  }
});

it.each([
  ['#FFFFFF', 'white', '#FFFFFF'], ['#FFFFFF', 'black', '#000000'],
  ['#000000', 'white', '#FFFFFF'], ['#000000', 'black', '#000000'],
  ['#A78BFA', 'white', '#FFFFFF'], ['#A78BFA', 'black', '#000000'],
] as const)('honours the explicit foreground for %s/%s even when contrast is low', (color, foreground, expected) => {
  for (const background of ['#F2F2F7', '#09090B']) {
    const tones = customAccentTones(color, background, foreground);
    expect(tones.accent).toBe(color);
    expect(tones.accentForeground).toBe(expected);
    expect(tones.accentSoft).toMatch(/^#[0-9A-F]{6}$/);
  }
});

it('uses white for old single-colour settings and copies an unconfigured mode', () => {
  expect(resolveAccentPair('#123456')).toEqual({
    light: { color: '#123456', foreground: 'white' }, dark: { color: '#123456', foreground: 'white' },
  });
  expect(resolveAccentPair({ light: { color: '#ABCDEF', foreground: 'black' } })).toEqual({
    light: { color: '#ABCDEF', foreground: 'black' }, dark: { color: '#ABCDEF', foreground: 'black' },
  });
  expect(resolveAccentPair({ dark: { color: '#111111', foreground: 'white' } }).light).toEqual({ color: '#111111', foreground: 'white' });
});

it('preserves independent colours and foregrounds when both modes are configured', () => {
  const configured = { light: { color: '#123456', foreground: 'white' }, dark: { color: '#FEDCBA', foreground: 'black' } } as const;
  expect(resolveAccentPair(configured)).toEqual(configured);
});
