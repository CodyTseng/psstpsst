import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { spacing, uiDensity } from '@/theme';

type Props = {
  /** Caller sets the icon color to match `tone`: `c.text` or `c.danger`. */
  icon: React.ReactNode;
  label: string;
  accessibilityLabel?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** `danger` tints the label red for destructive actions (e.g. Remove). */
  tone?: 'default' | 'danger';
  shape?: 'circle' | 'square';
  /** Fixed slots preserve action order in a horizontally scrolling rail. */
  layout?: 'equal' | 'fixed';
  /** Equal-column basis, or exact slot width when layout is fixed. */
  width?: number;
  size?: number;
  singleLineLabel?: boolean;
};

/**
 * An elevated icon control above a centered caption. Profile actions default
 * to circular controls in equal-width columns; horizontal rails can use fixed
 * slots and square controls without changing the shared button language.
 */
export function ProfileAction({ icon, label, accessibilityLabel, onPress, disabled, tone = 'default', shape = 'circle', layout = 'equal', width = uiDensity.profileActionWidth, size = uiDensity.profileActionSize, singleLineLabel = false }: Props) {
  return (
    <View
      style={{
        alignItems: 'center',
        gap: spacing.sm,
        flexBasis: width,
        flexGrow: layout === 'equal' ? 1 : 0,
        flexShrink: layout === 'equal' ? 1 : 0,
        minWidth: layout === 'fixed' ? width : 0,
        width: layout === 'fixed' ? width : undefined,
        paddingHorizontal: spacing.xs,
      }}
    >
      <IconButton
        variant="secondary"
        shape={shape}
        size={size}
        onPress={onPress}
        disabled={disabled}
        icon={icon}
        accessibilityLabel={accessibilityLabel ?? label}
      />
      <AppText
        variant="caption"
        tone={tone === 'danger' ? 'danger' : 'muted'}
        align="center"
        numberOfLines={singleLineLabel ? 1 : undefined}
        style={{ alignSelf: 'stretch' }}
      >
        {label}
      </AppText>
    </View>
  );
}
