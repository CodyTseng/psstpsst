import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';

import { dateTimePreferences } from '@/services/preferences/date-time-state';

/** Subscribe only mounted date/time consumers, including memoized rows. */
export function useDateTimePreferences() {
  const preferences = useStore(dateTimePreferences);
  const { i18n } = useTranslation();
  const language = i18n?.resolvedLanguage ?? i18n?.language;
  return useMemo(() => ({ ...preferences, language }), [preferences, language]);
}

/** Bootstrap observes readiness without re-rendering the application on format changes. */
export function useDateTimeLoaded() {
  return useStore(dateTimePreferences, state => state.loaded);
}
