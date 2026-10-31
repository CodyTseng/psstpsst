import * as Localization from 'expo-localization';

import { withLocaleRegion } from '@/lib/locale';

import type { LocalizationPort } from '../ports/localization';

/** Device locale backed by `expo-localization`. */
export const localizationAdapter: LocalizationPort = {
  dateTimeSettings: async () => {
    const locale = Localization.getLocales()[0];
    return {
      locale: locale ? withLocaleRegion(locale.languageTag, locale.regionCode) : null,
      uses24HourClock: Localization.getCalendars()[0]?.uses24hourClock ?? null,
    };
  },
  preferredLanguageTag: () => Localization.getLocales()[0]?.languageTag ?? null,
};
