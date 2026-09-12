import en from '@/i18n/en.json';
import { LANGUAGES, matchSupportedLanguage, TRANSLATIONS } from '@/i18n';
import { getLanguageDirection } from '@/i18n/direction';

function scalarEntries(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    scalarEntries(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(value: string): string[] {
  return value.match(/\{\{[^}]+\}\}/g)?.sort() ?? [];
}

const PLURAL_ROOTS = [
  'share.send_to_count',
  'import_contacts.import_selected',
  'import_contacts.imported_count',
  'key_rotation.interval_days',
  'emoji.emoji_count',
] as const;
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

describe('localization catalogs', () => {
  it.each(LANGUAGES)('%s ships every English key with matching placeholders', (language) => {
    const english = new Map(scalarEntries(en));
    const translated = new Map(scalarEntries(TRANSLATIONS[language]));

    expect([...english.keys()].filter((key) => !translated.has(key))).toEqual([]);
    for (const [key, value] of translated) {
      const source = english.get(key) ?? english.get(key.replace(PLURAL_SUFFIX, '_other'));
      expect(source).toBeDefined();
      expect(value.trim()).not.toBe('');
      expect(value).not.toContain('—');
      expect(placeholders(value)).toEqual(placeholders(source ?? ''));
    }
  });

  it.each(LANGUAGES)('%s ships every locale-specific plural form', (language) => {
    const translated = new Map(scalarEntries(TRANSLATIONS[language]));
    const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;

    for (const root of PLURAL_ROOTS) {
      for (const category of categories) {
        expect(translated.get(`${root}_${category}`)).toEqual(expect.any(String));
      }
    }
  });

  it('marks Arabic and Persian tags as RTL', () => {
    expect(getLanguageDirection('ar')).toBe('rtl');
    expect(getLanguageDirection('ar-SA')).toBe('rtl');
    expect(getLanguageDirection('fa')).toBe('rtl');
    expect(getLanguageDirection('fa-IR')).toBe('rtl');
    expect(getLanguageDirection('en')).toBe('ltr');
    expect(getLanguageDirection('zh-Hans')).toBe('ltr');
  });

  it.each([
    ['zh-Hans-CN', 'zh'],
    ['zh-Hant-TW', 'zh-Hant'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-Hans-HK', 'zh'],
    ['pt-BR', 'pt-BR'],
    ['pt-Latn-BR', 'pt-BR'],
    ['pt-PT', 'pt-PT'],
    ['pt', 'pt-PT'],
    ['fa-IR', 'fa'],
    ['de-DE', 'de'],
    ['unknown', 'en'],
  ] as const)('maps system locale %s to %s', (locale, expected) => {
    expect(matchSupportedLanguage(locale)).toBe(expected);
  });
});
