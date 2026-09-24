import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { BackHandler, Platform } from 'react-native';

/** Dismisses the focused in-window overlay before navigation or lower layers. */
export function useFocusedOverlayDismiss(active: boolean, onDismiss: () => void) {
  useFocusEffect(
    useCallback(() => {
      if (!active) return;

      const backSubscription =
        Platform.OS === 'android'
          ? BackHandler.addEventListener('hardwareBackPress', () => {
              onDismiss();
              return true;
            })
          : null;
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onDismiss();
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('keydown', handleKeyDown, true);
      }

      return () => {
        backSubscription?.remove();
        if (typeof document !== 'undefined') {
          document.removeEventListener('keydown', handleKeyDown, true);
        }
      };
    }, [active, onDismiss]),
  );
}
