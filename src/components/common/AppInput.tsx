import { forwardRef, type ReactNode, useState } from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';

import { radius, spacing, typography, uiDensity, useThemeColors } from '@/theme';

import { AppText } from './AppText';

type Props = TextInputProps & {
  invalid?: boolean;
  /** Short field name. Always rendered above the control as a muted caption. */
  label?: string;
  /** Supporting copy. Always rendered below the control as a muted caption. */
  description?: string;
  /** Current validation error. Replaces `description` and marks the field invalid. */
  error?: string;
  /** Control rendered beside the input, such as a scan or add action. */
  trailingAccessory?: ReactNode;
};

export const AppInput = forwardRef<TextInput, Props>(function AppInput(
  {
    invalid,
    label,
    description,
    error,
    trailingAccessory,
    style,
    onFocus,
    onBlur,
    accessibilityLabel,
    ...rest
  },
  ref,
) {
  const c = useThemeColors();
  const [focused, setFocused] = useState(false);

  const hasError = invalid === true || error != null;
  const supportingText = error ?? description;
  const borderColor = hasError ? c.danger : focused ? c.accent : c.border;
  const multiline = rest.multiline ?? false;

  const input = (
    <View
      style={{
        borderWidth: 1,
        borderColor,
        borderRadius: radius.lg,
        backgroundColor: c.surfaceElevated,
        paddingHorizontal: uiDensity.inputHorizontalPadding,
        height: multiline ? undefined : uiDensity.inputHeight,
        minHeight: multiline ? uiDensity.multilineInputMinHeight : undefined,
        paddingVertical: multiline ? 12 : 0,
        justifyContent: multiline ? 'flex-start' : 'center',
      }}
    >
      <TextInput
        ref={ref}
        placeholderTextColor={c.textMuted}
        {...rest}
        accessibilityLabel={accessibilityLabel ?? label}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            color: c.text,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.fontFamily ? typography.body.lineHeight : undefined,
            fontFamily: typography.body.fontFamily,
            paddingVertical: 0,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
      />
    </View>
  );

  const control =
    trailingAccessory == null ? (
      input
    ) : (
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{ flex: 1 }}>{input}</View>
        {trailingAccessory}
      </View>
    );

  if (label == null && supportingText == null && trailingAccessory == null) return input;

  return (
    <View style={{ gap: spacing.xs }}>
      {label != null ? (
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
      ) : null}
      {control}
      {supportingText != null ? (
        <AppText variant="caption" tone={hasError ? 'danger' : 'muted'}>
          {supportingText}
        </AppText>
      ) : null}
    </View>
  );
});
