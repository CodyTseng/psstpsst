import { createContext, useContext, type ReactNode } from 'react';

import { useThemeStore, type ThemePreference } from '@/stores/theme.store';

import { useSystemColorScheme } from './system-appearance';

export type EffectiveColorScheme = 'light' | 'dark';

const SystemColorSchemeContext = createContext<EffectiveColorScheme>('light');

export function resolveEffectiveColorScheme(
  preference: ThemePreference,
  systemScheme: ReturnType<typeof useSystemColorScheme>,
): EffectiveColorScheme {
  const scheme = preference === 'system' ? systemScheme : preference;
  return scheme === 'dark' ? 'dark' : 'light';
}

/**
 * Owns the app's single system-appearance subscription so every themed region
 * receives a system light/dark change in the same React commit.
 */
export function SystemColorSchemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useSystemColorScheme() === 'dark' ? 'dark' : 'light';

  return (
    <SystemColorSchemeContext.Provider value={systemScheme}>
      {children}
    </SystemColorSchemeContext.Provider>
  );
}

export function useEffectiveColorScheme(): EffectiveColorScheme {
  const systemScheme = useContext(SystemColorSchemeContext);
  const preference = useThemeStore((state) => state.preference);
  return resolveEffectiveColorScheme(preference, systemScheme);
}
