import X from 'lucide-react-native/icons/x';
import { View, type ViewStyle } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, useThemeColors } from '@/theme';

type QuoteTone = 'neutral' | 'onAccent';

type Props = {
  senderName: string;
  contentPreview: string;
  /** Contextual colour treatment; neutral is the app-wide default. */
  tone?: QuoteTone;
  /** Tap target (e.g. jump to the quoted message). A plain card when omitted. */
  onPress?: () => void;
  /** Renders a cancel button inside the card (composer); omitted in bubbles. */
  onCancel?: () => void;
  /** Bare look (composer): no fill, radius, or padding — just the accent
   * strip next to the text. The default is the filled rounded card. */
  bare?: boolean;
  /** Extra layout (e.g. `flex: 1` next to a sibling). */
  style?: ViewStyle;
};

/**
 * The quoted-reply card — one shared look for every place a reply is shown: in
 * a bubble (tap to jump to the source), inside the composer while replying, and
 * over a media/file attachment. A left accent bar + soft fill + rounded
 * corners, the sender's name then a one-line preview. Its two closed colour
 * tones keep every caller consistent: neutral for page/surface contexts and
 * onAccent for an own-message bubble. The composer uses the `bare` variant
 * instead: no card at all, just the neutral accent strip and text on the input
 * box's own surface. When `onCancel` is set, a dismiss button sits inside the
 * card on the right.
 */
export function QuotedReply({
  senderName,
  contentPreview,
  tone = 'neutral',
  onPress,
  onCancel,
  bare,
  style,
}: Props) {
  const c = useThemeColors();
  const onAccent = tone === 'onAccent';
  const accentColor = onAccent ? c.accentForeground : c.accent;
  const fillColor = onAccent ? c.accentForegroundSoft : c.insetFill;
  const contentColor = onAccent ? c.accentForegroundMuted : c.textMuted;

  const card: ViewStyle = bare
    ? {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }
    : {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: fillColor,
        borderLeftWidth: 2,
        borderLeftColor: accentColor,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: radius.sm,
      };
  // The text column. In the composer (a cancel X to pin at the right edge, in an
  // input box of definite width) it must FILL — `flex: 1` pushes the button to
  // the far edge. In a bubble / over media there's no button and the parent is
  // content-sized: filling would peg the card to the body text's width and
  // squeeze a long one-line preview to nothing when the reply itself is short.
  // Sizing to content instead lets the card grow the bubble out to its max width
  // when the quote needs it (`minWidth: 0` so it can still shrink-truncate once
  // the bubble is capped).
  const textCol: ViewStyle = onCancel
    ? { flex: 1, gap: 1 }
    : { flexShrink: 1, minWidth: 0, gap: 1 };
  const body = (
    <>
      {/* Bare mode has no border to lean on, so the accent strip is an
          explicit bar (rounded ends). The filled card uses border-left. */}
      {bare ? (
        <View
          style={{
            width: 2,
            alignSelf: 'stretch',
            borderRadius: 1,
            backgroundColor: accentColor,
          }}
        />
      ) : null}
      <View style={textCol}>
        <AppText variant="caption" weight="semibold" numberOfLines={1} style={{ color: accentColor }}>
          {senderName}
        </AppText>
        <AppText variant="caption" numberOfLines={1} style={{ color: contentColor }}>
          {contentPreview}
        </AppText>
      </View>
      {onCancel ? (
        // The shared IconButton primitive (Hard Rule 12), the same size token
        // and glyph size/stroke as the composer's trailing emoji button, so
        // the two read as one aligned pair.
        <IconButton
          variant="plain"
          size={spacing['2xl']}
          hitSlop={10}
          onPress={onCancel}
          icon={<X strokeWidth={iconStrokeWidth.default} size={20} color={contentColor} />}
        />
      ) : null}
    </>
  );
  if (!onPress) {
    return <View style={[card, style]}>{body}</View>;
  }
  return (
    <Pressable onPress={onPress} fallbackHoverOpacity={false} style={[card, style]}>
      {({ pressed }) => (
        <>
          {pressed ? <InteractionOverlay borderRadius={bare ? 0 : radius.sm} /> : null}
          {body}
        </>
      )}
    </Pressable>
  );
}
