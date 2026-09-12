import { useColorScheme } from 'react-native';

/** Isolates the native system-appearance source behind the theme root. */
export function useSystemColorScheme() {
  return useColorScheme();
}
