import CircleCheck from 'lucide-react-native/icons/circle-check';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  withTiming,
} from 'react-native-reanimated';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { successFeedback } from '@/lib/haptics';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

import { WalletAmountDisplay } from './WalletAmountDisplay';

type Props = {
  title: string;
  amount: string;
  amountUnit?: string | null;
  amountSourceCenterY?: number | null;
  description?: string | null;
  actionLabel: string;
  onAction: () => void;
};

const CHECK_ENTER_MS = 180;
const AMOUNT_MOVE_MS = 220;
const DETAILS_DELAY_MS = 90;
const DETAILS_ENTER_MS = 160;
const ACTION_DELAY_MS = 80;
const ACTION_ENTER_MS = 160;
const EASE_OUT = Easing.out(Easing.cubic);
// FadeIn is a web layout animation, so use the equivalent serializable bezier
// instead of the composed easing function used by withTiming above.
const FADE_EASE_OUT = Easing.bezier(1 / 3, 1, 2 / 3, 1);
const CHECK_SIZE = spacing['3xl'] + spacing.xl;
const CHECK_STAGE_SIZE = CHECK_SIZE + spacing.xl;

function checkEntering() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.92 }] },
    animations: {
      opacity: withTiming(1, { duration: CHECK_ENTER_MS, easing: EASE_OUT }),
      transform: [{ scale: withTiming(1, { duration: CHECK_ENTER_MS, easing: EASE_OUT }) }],
    },
  };
}

function makeAmountEntering(startOffsetY: number) {
  return () => {
    'worklet';
    return {
      initialValues: { transform: [{ translateY: startOffsetY }] },
      animations: {
        transform: [{ translateY: withTiming(0, { duration: AMOUNT_MOVE_MS, easing: EASE_OUT }) }],
      },
    };
  };
}

export function WalletSuccessState({
  title,
  amount,
  amountUnit,
  amountSourceCenterY,
  description,
  actionLabel,
  onAction,
}: Props) {
  const c = useThemeColors();
  const [amountOffsetY, setAmountOffsetY] = useState<number | null>(() =>
    amountSourceCenterY == null ? 0 : null,
  );
  const waitingForAmountMeasurement = amountSourceCenterY != null && amountOffsetY == null;
  const handleTargetAmountCenterY = useCallback(
    (targetCenterY: number) => {
      if (amountSourceCenterY == null) return;
      setAmountOffsetY((previous) => {
        if (previous != null) return previous;
        return amountSourceCenterY - targetCenterY;
      });
    },
    [amountSourceCenterY],
  );

  useEffect(() => {
    successFeedback();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'space-between', gap: spacing.xl }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.xl }}>
        <View style={{ alignSelf: 'stretch', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              width: CHECK_STAGE_SIZE,
              height: CHECK_STAGE_SIZE,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Animated.View entering={checkEntering}>
              <CircleCheck strokeWidth={iconStrokeWidth.default} size={CHECK_SIZE} color={c.success} />
            </Animated.View>
          </View>

          <Animated.View
            key={amountOffsetY == null ? 'amount-measure' : `amount:${Math.round(amountOffsetY)}`}
            entering={amountOffsetY == null ? undefined : makeAmountEntering(amountOffsetY)}
            style={{ alignSelf: 'stretch', opacity: waitingForAmountMeasurement ? 0 : 1 }}
          >
            <WalletAmountDisplay
              amount={amount}
              unit={amountUnit}
              onCenterYChange={handleTargetAmountCenterY}
            />
          </Animated.View>

          <Animated.View
            entering={FadeIn.delay(DETAILS_DELAY_MS)
              .duration(DETAILS_ENTER_MS)
              .easing(FADE_EASE_OUT)}
            style={{ alignSelf: 'stretch', alignItems: 'center', gap: spacing.sm }}
          >
            <AppText variant="title" weight="semibold" align="center">
              {title}
            </AppText>
            {description ? (
              <AppText variant="body" align="center" numberOfLines={2}>
                {description}
              </AppText>
            ) : null}
          </Animated.View>
        </View>
      </View>

      <Animated.View
        entering={FadeIn.delay(ACTION_DELAY_MS)
          .duration(ACTION_ENTER_MS)
          .easing(FADE_EASE_OUT)}
      >
        <AppButton label={actionLabel} variant="primary" size="lg" onPress={onAction} />
      </Animated.View>
    </View>
  );
}
