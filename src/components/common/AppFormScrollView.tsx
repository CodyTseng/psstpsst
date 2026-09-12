import { ScrollView, type ScrollViewProps } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { IS_ELECTRON } from '@/lib/platform';
import { spacing } from '@/theme';

/** Owns focused-field visibility for full-page forms. Do not nest keyboard avoidance. */
export function AppFormScrollView({ style, ...props }: ScrollViewProps) {
  if (IS_ELECTRON) {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        {...props}
        style={[{ flex: 1 }, style]}
      />
    );
  }

  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps="handled"
      {...props}
      // Leave room for the input's border and padding below the tracked caret.
      bottomOffset={spacing['2xl']}
      automaticallyAdjustKeyboardInsets={false}
      style={[{ flex: 1 }, style]}
    />
  );
}
