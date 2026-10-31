import * as Localization from 'expo-localization';

import { localizationAdapter } from '../localization';

jest.mock('expo-localization', () => ({ getLocales: jest.fn(), getCalendars: jest.fn() }));

const locales = jest.mocked(Localization.getLocales);
const calendars = jest.mocked(Localization.getCalendars);
const intlLocaleDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Locale')!;

beforeEach(() => {
  // Match Hermes, where Intl.Locale is absent.
  Object.defineProperty(Intl, 'Locale', { configurable: true, value: undefined });
  calendars.mockReturnValue([{ uses24hourClock: true }] as unknown as ReturnType<typeof Localization.getCalendars>);
});

afterEach(() => { Object.defineProperty(Intl, 'Locale', intlLocaleDescriptor); });

it.each([
  ['en-US', 'GB', 'en-GB'],
  ['zh-Hant-HK', 'TW', 'zh-Hant-TW'],
  ['es-ES', '419', 'es-419'],
  ['en-u-ca-gregory', 'GB', 'en-GB-u-ca-gregory'],
  ['de-CH-1901', 'DE', 'de-DE-1901'],
  ['zh-yue-Hant-HK', 'TW', 'zh-yue-Hant-TW'],
  ['en', null, 'en'],
])('reads the regional locale and clock without Intl.Locale: %s / %s', async (languageTag, regionCode, expected) => {
  locales.mockReturnValue([{ languageTag, regionCode }] as unknown as ReturnType<typeof Localization.getLocales>);
  await expect(localizationAdapter.dateTimeSettings()).resolves.toEqual({ locale: expected, uses24HourClock: true });
  expect(localizationAdapter.preferredLanguageTag()).toBe(languageTag);
});

it('preserves an explicit 12-hour override and unavailable locale data', async () => {
  locales.mockReturnValue([{ languageTag: 'pt-BR', regionCode: 'BR' }] as unknown as ReturnType<typeof Localization.getLocales>);
  calendars.mockReturnValue([{ uses24hourClock: false }] as unknown as ReturnType<typeof Localization.getCalendars>);
  await expect(localizationAdapter.dateTimeSettings()).resolves.toEqual({ locale: 'pt-BR', uses24HourClock: false });
  locales.mockReturnValue([] as unknown as ReturnType<typeof Localization.getLocales>);
  calendars.mockReturnValue([] as unknown as ReturnType<typeof Localization.getCalendars>);
  await expect(localizationAdapter.dateTimeSettings()).resolves.toEqual({ locale: null, uses24HourClock: null });
});
