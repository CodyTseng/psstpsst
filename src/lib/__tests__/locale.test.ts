import { formattingLocale, localeRegion, withLocaleRegion } from '../locale';

it.each([
  ['zh', 'en-US', 'zh-US'], ['zh-Hant', 'en-GB', 'zh-Hant-GB'],
  ['en', 'en-GB', 'en-GB'], ['en', 'zh-CN', 'en-CN'],
  ['pt-BR', 'ja-JP', 'pt-BR'], ['pt-PT', 'pt-BR', 'pt-PT'],
  ['en', 'en', 'en'], ['zh-Hant', 'en-US-u-ca-gregory', 'zh-Hant-US'],
])('combines UI %s and system %s as %s without Intl.Locale', (language, systemLocale, expected) => {
  expect(formattingLocale(language, systemLocale)).toBe(expected);
});

it('preserves scripts, variants and extensions when changing a region', () => {
  expect(withLocaleRegion('zh-yue-Hant-HK', 'TW')).toBe('zh-yue-Hant-TW');
  expect(withLocaleRegion('de-CH-1901', 'DE')).toBe('de-DE-1901');
  expect(withLocaleRegion('en-u-ca-gregory', 'GB')).toBe('en-GB-u-ca-gregory');
  expect(localeRegion('es-419')).toBe('419');
  expect(localeRegion('en-u-ca-gregory')).toBeNull();
});
