import * as Localization from 'expo-localization';

import type { LocalizationPort } from '../ports/localization';

/** Device locale backed by `expo-localization`. */
export const localizationAdapter: LocalizationPort = {
  preferredLanguageTag: () => Localization.getLocales()[0]?.languageTag ?? null,
};
