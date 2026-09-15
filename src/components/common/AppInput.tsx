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
    onChangeText,
    accessibilityLabel,
    placeholder,
    value,
    defaultValue,
    ...rest
  },
  ref,
) {
  const c = useThemeColors();
  const [focused, setFocused] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '');

  const hasError = invalid === true || error != null;
  const supportingText = error ?? description;
  const borderColor = hasError ? c.danger : focused ? c.accent : c.border;
  const multiline = rest.multiline ?? false;
  const currentValue = value ?? uncontrolledValue;
  const showTruncatedPlaceholder = !multiline && placeholder != null && currentValue.length === 0;

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
      {showTruncatedPlaceholder ? (
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            insetBlock: 0,
            insetInline: uiDensity.inputHorizontalPadding,
            justifyContent: 'center',
          }}
        >
          <AppText variant="body" tone="muted" numberOfLines={1} ellipsizeMode="tail">
            {placeholder}
          </AppText>
        </View>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={c.textMuted}
        {...rest}
        value={value}
        defaultValue={defaultValue}
        placeholder={multiline ? placeholder : undefined}
        multiline={multiline}
        numberOfLines={multiline ? rest.numberOfLines : 1}
        accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
        onChangeText={(nextValue) => {
          setUncontrolledValue(nextValue);
          onChangeText?.(nextValue);
        }}
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
