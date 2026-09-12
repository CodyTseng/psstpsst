import { router } from 'expo-router';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { useDisplayName } from '@/hooks/use-display-name';
import { useLanguageDirection } from '@/i18n/direction';
import { spacing, typography, useThemeColors } from '@/theme';

type Props = {
  authorPubkey: string;
  packTitle?: string;
  titleVariant?: 'caption' | 'body';
  prominentTitle?: boolean;
  withVerticalPadding?: boolean;
  /** Keep the heading geometry without profile requests or remote avatars. */
  loadRemote?: boolean;
  onPress?: (authorPubkey: string) => void;
};

const AUTHOR_AVATAR_SIZE = 20;
const COMPACT_AUTHOR_AVATAR_SIZE = 16;
const AUTHOR_CONTENT_GAP = 4;
const CHEVRON_SIZE = 16;
// The Solar glyph occupies x=9…15 in a 24px viewBox. Offset the physical glyph
// toward the row interior so its point, not the SVG box, aligns with the grid.
const CHEVRON_STROKE_WIDTH = 4;
const CHEVRON_OPTICAL_OFFSET = 6;

/** Shared pack heading placed directly before its grid: title left, author right. */
export function EmojiPackAuthorRow({
  authorPubkey,
  packTitle,
  titleVariant = 'body',
  prominentTitle = false,
  withVerticalPadding = true,
  loadRemote = true,
  onPress,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const { fontScale } = useWindowDimensions();
  const { name, profile } = useDisplayName(authorPubkey, loadRemote);
  const avatarSize = titleVariant === 'caption'
    ? COMPACT_AUTHOR_AVATAR_SIZE
    : AUTHOR_AVATAR_SIZE;
  const verticalPadding = withVerticalPadding ? spacing.sm : 0;
  // Empty text can measure shorter than a real title. Reserve the scaled line
  // box explicitly so resolving a pack name cannot resize its message card.
  const headingHeight = prominentTitle
    ? Math.max(
        typography.subtitle.lineHeight * fontScale,
        typography[titleVariant].lineHeight * fontScale,
        avatarSize,
        CHEVRON_SIZE,
      ) + verticalPadding * 2
    : undefined;

  function openAuthorPacks() {
    if (onPress) {
      onPress(authorPubkey);
      return;
    }
    router.push({
      pathname: '/emoji-author/[pubkey]',
      params: { pubkey: authorPubkey },
    });
  }

  return (
    <View
      style={{
        direction,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: verticalPadding,
        height: headingHeight,
      }}
    >
      {packTitle || prominentTitle ? (
        <AppText
          variant={prominentTitle ? 'subtitle' : titleVariant}
          weight={prominentTitle ? 'bold' : 'regular'}
          tone={prominentTitle ? 'default' : 'muted'}
          numberOfLines={1}
          style={{ flex: 1, minWidth: 0, includeFontPadding: false }}
        >
          {packTitle || ' '}
        </AppText>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <Pressable
        disabled={!loadRemote}
        pressFeedback="delayed"
        // `link`, not `button`: this row nests inside the reference card's own
        // button-role Pressable, and nested <button> elements are invalid HTML
        // on web (React throws a hydration error). A link role keeps the DOM
        // valid there and matches what the action does — navigate to the
        // author's page.
        accessibilityRole="link"
        hitSlop={8}
        style={({ pressed }) => ({
          direction,
          flexDirection: 'row',
          alignItems: 'center',
          gap: AUTHOR_CONTENT_GAP,
          maxWidth: '64%',
          marginStart: 'auto',
          opacity: pressed ? 0.55 : 1,
        })}
        accessibilityLabel={t('emoji.view_author_packs', { name })}
        onPress={(event) => {
          event.stopPropagation();
          openAuthorPacks();
        }}
      >
        <Avatar
          pubkey={authorPubkey}
          picture={loadRemote ? profile?.picture : undefined}
          name={name}
          size={avatarSize}
        />
        <AppText
          variant={titleVariant}
          weight="regular"
          tone="muted"
          numberOfLines={1}
          style={{ flexShrink: 1, includeFontPadding: false }}
        >
          {name}
        </AppText>
        <View
          style={{
            marginStart: spacing.sm,
            width: CHEVRON_STROKE_WIDTH,
            height: CHEVRON_SIZE,
            overflow: 'visible',
          }}
        >
          <ChevronRight
            size={CHEVRON_SIZE}
            color={c.textMuted}
            style={{
              transform: [{
                translateX: direction === 'rtl'
                  ? CHEVRON_OPTICAL_OFFSET
                  : -CHEVRON_OPTICAL_OFFSET,
              }],
            }}
          />
        </View>
      </Pressable>
    </View>
  );
}
