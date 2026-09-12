import { useTranslation } from 'react-i18next';

const RTL_LANGUAGES = new Set(['ar', 'fa']);

/** Resolve a BCP-47 language tag to the app's logical layout direction. */
export function getLanguageDirection(language: string | undefined): 'ltr' | 'rtl' {
  const baseLanguage = language?.split('-')[0]?.toLowerCase();
  return baseLanguage && RTL_LANGUAGES.has(baseLanguage) ? 'rtl' : 'ltr';
}

/** Reactive layout direction for the currently resolved i18next language. */
export function useLanguageDirection(): 'ltr' | 'rtl' {
  const { i18n } = useTranslation();
  return getLanguageDirection(i18n?.resolvedLanguage ?? i18n?.language ?? 'en');
}

export function useIsRTL(): boolean {
  return useLanguageDirection() === 'rtl';
}

/** Mirror an icon whose meaning carries a horizontal direction. */
export function useDirectionalIconStyle() {
  const isRTL = useIsRTL();
  return isRTL ? { transform: [{ scaleX: -1 }] } : undefined;
}
