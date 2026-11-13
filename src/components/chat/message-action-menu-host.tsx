import { type ReactNode, useEffect } from 'react';
import { Modal, Platform, View } from 'react-native';
import { KeyboardEvents, OverKeyboardView } from 'react-native-keyboard-controller';

/** Keeps Android's focused composer and measured message geometry in place. */
export function MessageActionMenuHost({ active, children, onClose }: {
  active: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (Platform.OS !== 'android' || !active) return;
    // System Back can dismiss the IME before BackHandler receives the event.
    // Close the anchored menu as well, before its source starts moving.
    const subscription = KeyboardEvents.addListener('keyboardWillHide', onClose);
    return () => subscription.remove();
  }, [active, onClose]);

  if (Platform.OS === 'android') {
    return (
      <OverKeyboardView visible>
        <View style={{ flex: 1 }} accessibilityViewIsModal>
          {children}
        </View>
      </OverKeyboardView>
    );
  }

  return (
    <Modal visible transparent statusBarTranslucent onRequestClose={onClose}>
      {children}
    </Modal>
  );
}
