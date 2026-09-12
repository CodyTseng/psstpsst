import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { spacing } from '@/theme';

type Props = {
  amount: string;
  unit?: string | null;
  color?: string;
  onCenterYChange?: (centerY: number) => void;
};

export function WalletAmountDisplay({ amount, unit, color, onCenterYChange }: Props) {
  const { t } = useTranslation();
  const rootRef = useRef<View>(null);
  const [value, inferredUnit] = splitAmountUnit(amount, t('wallet.sats_unit'));
  const displayUnit = unit === undefined ? inferredUnit : unit;
  const shouldShrink = value.length > 9;
  const handleLayout = useCallback(
    (_event: LayoutChangeEvent) => {
      if (!onCenterYChange) return;
      requestAnimationFrame(() => {
        rootRef.current?.measureInWindow((_x, y, _width, height) => {
          if (height > 0) onCenterYChange(y + height / 2);
        });
      });
    },
    [onCenterYChange],
  );
  const fittingProps = shouldShrink
    ? {
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.68,
      }
    : undefined;

  return (
    <View
      ref={rootRef}
      onLayout={handleLayout}
      style={{ alignSelf: 'stretch', alignItems: 'center', gap: spacing.xs }}
    >
      <AppText
        variant="amount"
        weight="bold"
        align="center"
        numberOfLines={1}
        {...fittingProps}
        style={[{ width: '100%' }, color ? { color } : null]}
      >
        {value}
      </AppText>
      {displayUnit ? (
        <AppText variant="caption" tone="muted" align="center">
          {displayUnit}
        </AppText>
      ) : null}
    </View>
  );
}

function splitAmountUnit(amount: string, satsUnit: string): [string, string | null] {
  const suffix = ` ${satsUnit}`;
  if (amount.endsWith(suffix)) return [amount.slice(0, -suffix.length), satsUnit];
  return [amount, null];
}
