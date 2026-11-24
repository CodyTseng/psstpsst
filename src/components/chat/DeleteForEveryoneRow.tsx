import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/common/AppText';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { Toggle } from '@/components/common/Toggle';
import { spacing } from '@/theme';

const NAME_SLOT = '\uFFFC';

type Props = {
  group: boolean;
  peerName: string | null;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
};

export function DeleteForEveryoneRow({ group, peerName, value, disabled, onValueChange }: Props) {
  const { t } = useTranslation();
  const name = group ? null : peerName;
  const [before, after = ''] = name
    ? t('chat.message_delete.named_peer', { name: NAME_SLOT }).split(NAME_SLOT)
    : [t(group ? 'chat.message_delete.group' : 'chat.message_delete.peer')];

  return (
    <InteractivePressable
      accessibilityRole="switch"
      accessibilityLabel={before + (name ?? '') + after}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hoverFeedback={false}
      onPress={() => onValueChange(!value)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: spacing['3xl'],
        gap: spacing.md,
      }}
    >
      <AppText numberOfLines={2} ellipsizeMode="tail" style={{ flex: 1, minWidth: 0 }}>
        {before}
        {name ? <AppText weight="bold">{name}</AppText> : null}
        {after}
      </AppText>
      <View style={{ flexShrink: 0, pointerEvents: 'none' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Toggle value={value} disabled={disabled} />
      </View>
    </InteractivePressable>
  );
}
