import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { IconButton } from '@/components/common/IconButton';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  pubkey: string;
  displayName: string;
  secondaryText: string;
  secondaryTone?: 'muted' | 'success' | 'warning';
  value?: string;
  valueTone?: 'muted' | 'success' | 'warning';
  showSeparator?: boolean;
  onPress: () => void;
  infoIcon?: React.ReactNode;
  infoAccessibilityLabel?: string;
  onInfoPress?: () => void;
};

const ROW_HEIGHT = uiDensity.conversationRowHeight;
const AVATAR_SIZE = uiDensity.conversationAvatarSize;
const CONTENT_INSET = spacing.lg + AVATAR_SIZE + spacing.md;

/** Nearby row with secondary metadata and a separate detail action. */
export function NearbyPeerListItem({
  pubkey,
  displayName,
  secondaryText,
  secondaryTone = 'muted',
  value,
  valueTone = 'muted',
  showSeparator = false,
  onPress,
  infoIcon,
  infoAccessibilityLabel,
  onInfoPress,
}: Props) {
  const c = useThemeColors();
  const [rowHovered, setRowHovered] = useState(false);
  const [rowPressed, setRowPressed] = useState(false);

  return (
    <View>
      <View
        style={{
          height: ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: rowHovered || rowPressed ? c.interactionOverlay : c.background,
        }}
      >
        <Pressable
          accessibilityRole="button"
          pressFeedback="delayed"
          onPress={onPress}
          onPressIn={() => setRowPressed(true)}
          onPressOut={() => setRowPressed(false)}
          onHoverIn={() => setRowHovered(true)}
          onHoverOut={() => setRowHovered(false)}
          style={{
            height: ROW_HEIGHT,
            paddingStart: spacing.lg,
            paddingEnd: onInfoPress ? spacing.sm : spacing.lg,
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <Avatar pubkey={pubkey} name={displayName} size={AVATAR_SIZE} />
          <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
            <AppText variant="subtitle" numberOfLines={1}>
              {displayName}
            </AppText>
            <AppText variant="caption" tone={secondaryTone} numberOfLines={1}>
              {secondaryText}
            </AppText>
          </View>
          {value ? (
            <AppText
              variant="caption"
              weight="semibold"
              tone={valueTone}
              numberOfLines={1}
            >
              {value}
            </AppText>
          ) : null}
        </Pressable>
        {onInfoPress && infoIcon ? (
          <IconButton
            icon={infoIcon}
            size={uiDensity.iconButtonSize}
            variant="plain"
            accessibilityLabel={infoAccessibilityLabel}
            onPress={onInfoPress}
            style={{ marginEnd: spacing.lg }}
          />
        ) : null}
      </View>
      {showSeparator ? (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            marginStart: CONTENT_INSET,
            backgroundColor: c.border,
          }}
        />
      ) : null}
    </View>
  );
}
