import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { BackHandler } from 'react-native';

type Props = {
  active: boolean;
  onCancel: () => void;
};

/** Cancels message selection before a focused chat handles normal navigation. */
export function ChatSelectionCancelHandler({ active, onCancel }: Props) {
  useFocusEffect(
    useCallback(() => {
      if (!active) return;

      const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onCancel();
        return true;
      });
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('keydown', handleKeyDown, true);
      }

      return () => {
        backSubscription.remove();
        if (typeof document !== 'undefined') {
          document.removeEventListener('keydown', handleKeyDown, true);
        }
      };
    }, [active, onCancel]),
  );

  return null;
}
