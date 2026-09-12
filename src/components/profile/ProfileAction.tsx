import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { spacing, uiDensity } from '@/theme';

type Props = {
  /** Caller sets the icon color to match `tone`: `c.text` or `c.danger`. */
  icon: React.ReactNode;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** `danger` tints the label red for destructive actions (e.g. Remove). */
  tone?: 'default' | 'danger';
};

/**
 * A single profile action: a circular white (`elevated`) `IconButton` over a
 * caption label — floats on the grouped profile page. Reuses PsstPsst's own
 * button language rather than a foreign capsule/tile style. Drop several into a
 * centered row to form the action strip on profile screens (DESIGN §8).
 */
export function ProfileAction({ icon, label, onPress, disabled, tone = 'default' }: Props) {
  return (
    <View
      style={{
        alignItems: 'center',
        gap: spacing.sm,
        flexBasis: uiDensity.profileActionWidth,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        paddingHorizontal: spacing.xs,
      }}
    >
      <IconButton
        variant="secondary"
        shape="circle"
        size={uiDensity.profileActionSize}
        onPress={onPress}
        disabled={disabled}
        icon={icon}
        accessibilityLabel={label}
      />
      <AppText
        variant="caption"
        tone={tone === 'danger' ? 'danger' : 'muted'}
        align="center"
        style={{ alignSelf: 'stretch' }}
      >
        {label}
      </AppText>
    </View>
  );
}
