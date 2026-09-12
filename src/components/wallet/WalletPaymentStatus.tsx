import CircleCheck from 'lucide-react-native/icons/circle-check';
import { RefreshCircle as LoaderCircle } from '@solar-icons/react-native/category/arrows/Linear/RefreshCircle';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, typography, useThemeColors } from '@/theme';

import { WalletAmountDisplay } from './WalletAmountDisplay';

export type WalletPaymentStatusValue = 'processing' | 'success';

type Props = {
  status: WalletPaymentStatusValue;
  amount: string;
  processingLabel: string;
  successTitle: string;
  actionLabel: string;
  onAction: () => void;
};

const ICON_SIZE = spacing['3xl'];
const ICON_STAGE_SIZE = ICON_SIZE + spacing.xl;
const SPIN_MS = 900;
const TRANSITION_MS = 180;
const ENTER_DELAY_MS = 60;
const EASE_OUT = Easing.out(Easing.cubic);

export function WalletPaymentStatus({
  status,
  amount,
  processingLabel,
  successTitle,
  actionLabel,
  onAction,
}: Props) {
  const c = useThemeColors();
  const rotation = useSharedValue(0);
  const loaderOpacity = useSharedValue(1);
  const checkOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0.92);
  const successContentOpacity = useSharedValue(0);

  useEffect(() => {
    if (status === 'processing') {
      loaderOpacity.value = 1;
      checkOpacity.value = 0;
      checkScale.value = 0.92;
      successContentOpacity.value = 0;
      rotation.value = 0;
      rotation.value = withRepeat(
        withTiming(360, { duration: SPIN_MS, easing: Easing.linear }),
        -1,
        false,
      );
      return;
    }

    cancelAnimation(rotation);
    loaderOpacity.value = withTiming(0, { duration: TRANSITION_MS, easing: EASE_OUT });
    checkOpacity.value = withTiming(1, { duration: TRANSITION_MS, easing: EASE_OUT });
    checkScale.value = withTiming(1, { duration: TRANSITION_MS, easing: EASE_OUT });
    successContentOpacity.value = withDelay(
      ENTER_DELAY_MS,
      withTiming(1, { duration: TRANSITION_MS, easing: EASE_OUT }),
    );
  }, [checkOpacity, checkScale, loaderOpacity, rotation, status, successContentOpacity]);

  useEffect(
    () => () => {
      cancelAnimation(rotation);
    },
    [rotation],
  );

  const loaderStyle = useAnimatedStyle(() => ({
    opacity: loaderOpacity.value,
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));
  const successContentStyle = useAnimatedStyle(() => ({ opacity: successContentOpacity.value }));
  const processing = status === 'processing';

  return (
    <View style={{ flex: 1, gap: spacing.xl }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        <View
          accessible
          accessibilityLabel={processing ? processingLabel : successTitle}
          accessibilityLiveRegion="polite"
          style={{
            width: ICON_STAGE_SIZE,
            height: ICON_STAGE_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Animated.View style={[{ position: 'absolute' }, loaderStyle]}>
            <LoaderCircle size={ICON_SIZE} color={c.accent} />
          </Animated.View>
          <Animated.View style={[{ position: 'absolute' }, checkStyle]}>
            <CircleCheck strokeWidth={iconStrokeWidth.default} size={ICON_SIZE} color={c.success} />
          </Animated.View>
        </View>

        <WalletAmountDisplay amount={amount} />

        <View style={{ height: typography.title.lineHeight, justifyContent: 'center' }}>
          <Animated.View style={successContentStyle}>
            <AppText variant="title" weight="semibold" align="center">
              {successTitle}
            </AppText>
          </Animated.View>
        </View>
      </View>

      <Animated.View
        style={[successContentStyle, { pointerEvents: processing ? 'none' : 'auto' }]}
        accessibilityElementsHidden={processing}
        importantForAccessibility={processing ? 'no-hide-descendants' : 'auto'}
      >
        <AppButton label={actionLabel} variant="primary" size="lg" onPress={onAction} />
      </Animated.View>
    </View>
  );
}
