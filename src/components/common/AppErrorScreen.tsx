import { View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { spacing } from '@/theme';

type Props = {
  title: string;
  message: string;
  retryLabel: string;
  homeLabel: string;
  exportLabel: string;
  repeated: boolean;
  busy: boolean;
  onRetry: () => void;
  onHome: () => void;
  onExport: () => void;
};

/** Recovery UI rendered by the root Expo Router error boundary. */
export function AppErrorScreen({
  title,
  message,
  retryLabel,
  homeLabel,
  exportLabel,
  repeated,
  busy,
  onRetry,
  onHome,
  onExport,
}: Props) {
  return (
    <AppScreen>
      <AppContentColumn>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingHorizontal: spacing.lg,
            gap: spacing.xl,
          }}
        >
          <View style={{ gap: spacing.sm }}>
            <AppText variant="display" weight="bold" align="center">
              {title}
            </AppText>
            <AppText variant="body" tone="muted" align="center">
              {message}
            </AppText>
          </View>
          <View style={{ gap: spacing.md }}>
            <AppButton
              label={repeated ? homeLabel : retryLabel}
              variant="primary"
              size="lg"
              loading={busy}
              onPress={repeated ? onHome : onRetry}
            />
            <AppButton
              label={repeated ? retryLabel : homeLabel}
              variant="secondary"
              size="lg"
              disabled={busy}
              onPress={repeated ? onRetry : onHome}
            />
            <AppButton
              label={exportLabel}
              variant="accentText"
              disabled={busy}
              onPress={onExport}
            />
          </View>
        </View>
      </AppContentColumn>
    </AppScreen>
  );
}
