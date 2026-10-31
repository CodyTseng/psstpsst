import { forwardRef, type ReactNode, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { radius, spacing, typography, uiDensity, useThemeColors } from '@/theme';

import { AppText } from './AppText';

type Props = TextInputProps & {
  invalid?: boolean;
  /** Borderless editable segment inside a compound field. */
  variant?: 'default' | 'segment';
  /** Short field name. Always rendered above the control as a muted caption. */
  label?: string;
  /** Supporting copy. Always rendered below the control as a muted caption. */
  description?: string;
  /** Current validation error. Replaces `description` and marks the field invalid. */
  error?: string;
  /** Control rendered beside the input, such as a scan or add action. */
  trailingAccessory?: ReactNode;
  /** Compact control rendered inside the input at its logical end. */
  inputTrailingAccessory?: ReactNode;
};

export const AppInput = forwardRef<TextInput, Props>(function AppInput(
  {
    invalid,
    variant = 'default',
    label,
    description,
    error,
    trailingAccessory,
    inputTrailingAccessory,
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
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => inputRef.current!, []);
  const [focused, setFocused] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '');

  const hasError = invalid === true || error != null;
  const supportingText = error ?? description;
  const borderColor = hasError ? c.danger : focused ? c.accent : c.border;
  const multiline = rest.multiline ?? false;
  const currentValue = value ?? uncontrolledValue;
  const showTruncatedPlaceholder = !multiline && placeholder != null && currentValue.length === 0;
  const textAlign = StyleSheet.flatten(style)?.textAlign;

  const segment = variant === 'segment';
  const inputTypography = segment ? typography.title : typography.body;

  const input = (
    <Pressable
      accessible={false}
      focusable={false}
      tabIndex={-1}
      onPress={() => {
        if (rest.editable !== false) inputRef.current?.focus();
      }}
      style={{
        borderWidth: segment ? 0 : 1,
        borderColor,
        borderRadius: segment ? radius.md : radius.lg,
        backgroundColor: segment ? 'transparent' : c.surfaceElevated,
        paddingHorizontal: segment ? spacing.xs : uiDensity.inputHorizontalPadding,
        height: multiline ? undefined : uiDensity.inputHeight,
        minHeight: multiline ? uiDensity.multilineInputMinHeight : undefined,
        paddingVertical: multiline ? 12 : 0,
        justifyContent: multiline ? 'flex-start' : 'center',
        flexDirection: 'row',
        alignItems: multiline ? 'stretch' : 'center',
      }}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row' }}>
        {showTruncatedPlaceholder ? (
          <View
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              insetBlock: 0,
              insetInline: 0,
              justifyContent: 'center', pointerEvents: 'none' }}
          >
            <AppText
              variant="body"
              tone="muted"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={textAlign == null ? undefined : { textAlign }}
            >
              {placeholder}
            </AppText>
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
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
              fontSize: inputTypography.fontSize,
              lineHeight: inputTypography.fontFamily ? inputTypography.lineHeight : undefined,
              fontFamily: inputTypography.fontFamily,
              flex: 1,
              // HTML inputs have an intrinsic width; constrain them to the field shell.
              minWidth: 0,
              width: '100%',
              paddingVertical: 0,
              // The shell owns the inset; native padding would offset the caret
              // from the separately rendered single-line placeholder.
              paddingStart: 0,
              paddingEnd: 0,
              textAlignVertical: multiline ? 'top' : 'center',
              outlineStyle: segment ? 'solid' : undefined,
              outlineWidth: segment ? 0 : undefined,
            },
            style,
          ]}
        />
      </View>
      {inputTrailingAccessory ? (
        <View style={{ flexShrink: 0 }}>{inputTrailingAccessory}</View>
      ) : null}
    </Pressable>
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
