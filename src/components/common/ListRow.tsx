import { useContext, useState } from 'react';
import {
  ActivityIndicator,
  type TextProps,
  View,
} from 'react-native';

import {
  InteractivePressable as Pressable,
  isInteractiveHovered,
} from '@/components/common/InteractivePressable';

import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

import { AppText } from './AppText';
import { ListGroupContext } from './list-group-context';
import { InteractionOverlay } from './InteractionOverlay';
import { MiddleEllipsizedText } from './MiddleEllipsizedText';

// Signal-style mobile metrics with a denser pointer-first Electron variant.
// Shared so ListGroup's separator lines up with the title on both platforms.
const ROW_HEIGHT = uiDensity.listRowHeight;
const ROW_HEIGHT_WITH_SUBTITLE = uiDensity.listRowTwoLineHeight;
const ROW_PADDING_H = uiDensity.listRowHorizontalPadding;
// Borderless sheet-option row (iOS action-sheet style): a roomy inner inset, and
// the pressed pill bleeds `PLAIN_BLEED` past the sheet's 16 gutter toward the
// edge so it keeps an even ~8px margin instead of looking over-margined.
const PLAIN_PADDING_H = 16;
const PLAIN_BLEED = 8;
const ICON_SLOT = 28; // fixed icon column width (icon glyph ≈22, centered)
const ICON_OPTICAL_SHIFT = 3; // align a typical 22px glyph with the visible row edge
const ICON_GAP = uiDensity.listRowIconGap;
const VALUE_MAX_WIDTH = '68%';
/** Where a grouped row's content (title) starts — the separator inset, so the
 * hairline aligns with the title and clears the icon. */
export const ROW_CONTENT_INSET = ROW_PADDING_H + ICON_SLOT + ICON_GAP; // 60 mobile / 56 Electron

type Variant = 'card' | 'plain' | 'embedded' | 'list' | 'inline';
type TitleTone = 'default' | 'muted' | 'danger' | 'accent';
type ValueTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';
type ValuePlacement = 'trailing' | 'below';
type PreserveColumn = 'title' | 'value';
type SelectionMode = 'single';

type Props = {
  /** An icon node — rendered as-is in a fixed-width slot (no background).
   * Caller sets its size (≈22) and color (match `titleTone`). */
  icon?: React.ReactNode;
  title: string;
  /** Non-shrinking status after the title; long titles truncate before it. */
  titleTrailing?: React.ReactNode;
  subtitle?: string;
  /** Supporting content with inline status or identity semantics. */
  subtitleContent?: React.ReactNode;
  subtitleTone?: ValueTone;
  /** Lets a registered supporting description wrap instead of truncating. */
  subtitleMultiline?: boolean;
  titleTone?: TitleTone;
  /** Optional factual detail. It is right-aligned by default; long identity
   * values may use `valuePlacement="below"` to span the text column. */
  value?: string;
  /** Identity visual kept beside a trailing value while its text truncates. */
  valueLeading?: React.ReactNode;
  /** Custom renderer for a below-placed value whose inline semantics cannot be
   * represented by one text node, such as a verified NIP-05 identifier. */
  belowValue?: React.ReactNode;
  valueTone?: ValueTone;
  /** `below` gives long factual values the full text-column width, with the
   * field label rendered quietly above them. */
  valuePlacement?: ValuePlacement;
  /** Lets long identifiers use the available width before native truncation. */
  valueEllipsizeMode?: TextProps['ellipsizeMode'];
  /** Allows a factual right-side value to wrap while staying in the value column. */
  valueMultiline?: boolean;
  /** Which horizontal text column keeps its intrinsic width when space is tight.
   * Defaults to the left title; use `value` for rows whose metadata must remain complete. */
  preserveColumn?: PreserveColumn;
  /** Right-hand accessory (chevron, copy icon …). Replaced by a spinner while loading. */
  trailing?: React.ReactNode;
  /** Optional accessory revealed only while a pointer hovers the row. */
  trailingOnHover?: React.ReactNode;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Persistent primary-pane selection for the detail route shown beside it.
   * Uses the same muted surface as press feedback so selection settles without
   * a color flash after the route opens. */
  active?: boolean;
  /** Gives a selectable row radio semantics. Pair with a trailing
   * `RadioIndicator`; `active` supplies its checked state. */
  selectionMode?: SelectionMode;
  /** Standalone only — ignored inside a `ListGroup`. `card` = lone bordered row;
   * `plain` = borderless sheet-option row; `embedded` = opaque content whose
   * parent owns the fixed card border/radius (for swipeable wrappers);
   * `list` = transparent, full-width row with rectangular feedback;
   * `inline` = compact metadata aligned with surrounding text. */
  variant?: Variant;
  /** Content-height inline metadata; expanded hit slop preserves its touch target. */
  compact?: boolean;
};

/**
 * The canonical tappable row: a plain line icon + single-line title (+ optional
 * factual value) + optional trailing accessory (DESIGN §8). Signal/iOS
 * style — no tinted icon circle, regular-weight title, fixed-height default
 * layout; factual metadata can opt into a multiline right value. Explanatory
 * copy belongs on the screen the row opens. Group ≥2 related rows with
 * {@link ListGroup}. Contact and conversation rows with a leading avatar,
 * swipe actions, or unread indicators use their own identity components.
 */
export function ListRow({
  icon,
  title,
  titleTrailing,
  subtitle,
  subtitleContent,
  subtitleTone = 'muted',
  subtitleMultiline = false,
  titleTone = 'default',
  value,
  valueLeading,
  belowValue,
  valueTone = 'muted',
  valuePlacement = 'trailing',
  valueEllipsizeMode,
  valueMultiline = false,
  preserveColumn = 'title',
  trailing,
  trailingOnHover,
  onPress,
  loading,
  disabled,
  active = false,
  selectionMode,
  variant = 'card',
  compact = false,
}: Props) {
  const c = useThemeColors();
  const grouped = useContext(ListGroupContext);
  const [hoverAccessoryVisible, setHoverAccessoryVisible] = useState(false);

  const titleColor = { default: c.text, muted: c.textMuted, danger: c.danger, accent: c.accent }[titleTone];
  const valueColor = {
    default: c.text,
    muted: c.textMuted,
    success: c.success,
    warning: c.warning,
    danger: c.danger,
  }[valueTone];
  const hasSubtitle = subtitleContent != null || (subtitle != null && subtitle.length > 0);
  const hasBelowValue =
    valuePlacement === 'below' &&
    ((value != null && value.length > 0) || belowValue != null);
  const hasTrailingValue = valuePlacement === 'trailing' && value != null && value.length > 0;
  const hasTwoLineContent = hasSubtitle || hasBelowValue;
  const multilineValue =
    hasTrailingValue && valueMultiline;
  const multilineContent = multilineValue || (hasSubtitle && subtitleMultiline);
  // Column preservation only applies when title and value compete side by side.
  // A single text stack must yield to its trailing accessory so long labels,
  // subtitles, and identifiers stay inside the row.
  const shrinkContent = !hasTrailingValue || preserveColumn === 'value';
  // Inside a ListGroup the row is embedded — the group paints the card chrome
  // and separators, so the row itself is just a transparent tappable strip.
  const isCard = !grouped && variant === 'card';
  const isPlain = !grouped && variant === 'plain';
  const isEmbedded = !grouped && variant === 'embedded';
  const isInline = !grouped && variant === 'inline';
  const compactInline = isInline && compact;
  const rowHeight = compactInline ? spacing.xl : isInline ? uiDensity.listRowCompactHeight : ROW_HEIGHT;
  const rowRadius = isCard || isPlain || isInline ? radius.lg : 0;
  const titleText = <AppText
    variant={hasBelowValue || isInline ? 'caption' : 'subtitle'} weight="regular" numberOfLines={1}
    style={{ color: hasBelowValue ? c.textMuted : titleColor, ...(titleTrailing ? { flexShrink: 1, minWidth: 0 } : {}) }}>
    {title}
  </AppText>;

  return (
    <Pressable
      onPress={onPress}
      hitSlop={compactInline ? { top: spacing.md, bottom: spacing.md } : undefined}
      accessible={onPress != null}
      accessibilityRole={selectionMode === 'single' ? 'radio' : undefined}
      hoverFeedback={onPress && trailingOnHover == null ? undefined : false}
      onHoverIn={trailingOnHover == null ? undefined : () => setHoverAccessoryVisible(true)}
      onHoverOut={trailingOnHover == null ? undefined : () => setHoverAccessoryVisible(false)}
      pressFeedback="delayed"
      fallbackHoverOpacity={false}
      disabled={disabled || (!onPress && trailingOnHover == null && trailing == null)}
      accessibilityState={
        selectionMode === 'single' ? { checked: active } : { selected: active }
      }
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: ICON_GAP,
        minHeight: compactInline ? rowHeight : multilineContent
          ? hasTwoLineContent
            ? ROW_HEIGHT_WITH_SUBTITLE
            : rowHeight
          : undefined,
        height: multilineContent
          ? undefined
          : hasTwoLineContent
            ? ROW_HEIGHT_WITH_SUBTITLE
            : compactInline ? undefined : rowHeight,
        paddingVertical: multilineContent ? spacing.sm : 0,
        paddingHorizontal: isInline ? spacing.sm : isPlain ? PLAIN_PADDING_H : ROW_PADDING_H,
        marginHorizontal: isInline ? -spacing.sm : isPlain ? -PLAIN_BLEED : 0,
        borderRadius: rowRadius,
        overflow: 'hidden',
        borderWidth: isCard ? 1 : 0,
        borderColor: c.border,
        backgroundColor: isCard || isEmbedded ? c.surfaceElevated : 'transparent',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {(state) => {
        const hovered = isInteractiveHovered(state) || hoverAccessoryVisible;
        const visibleTrailing = loading
          ? <ActivityIndicator color={c.textMuted} />
          : trailingOnHover
            ? (
                <View
                  accessibilityElementsHidden={!hovered}
                  importantForAccessibility={hovered ? 'auto' : 'no-hide-descendants'}
                  style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none' }}
                >
                  {trailingOnHover}
                </View>
              )
            : trailing;
        return (
          <>
            {!isInline && (hovered || state.pressed || active) ? (
              <InteractionOverlay />
            ) : null}
            {icon ? (
              <View
                style={{
                  width: ICON_SLOT,
                  alignItems: 'center',
                  transform: [{ translateX: -ICON_OPTICAL_SHIFT }],
                }}
              >
                {icon}
              </View>
            ) : null}

            <View
              style={{
                flexGrow: 1,
                flexShrink: shrinkContent ? 1 : 0,
                minWidth: shrinkContent ? 0 : undefined,
                gap: 2,
              }}
            >
              {titleTrailing ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {titleText}<View style={{ flexShrink: 0 }}>{titleTrailing}</View>
              </View> : titleText}
              {hasBelowValue ? (
                belowValue ?? (
                  valueEllipsizeMode === 'middle' && value ? (
                    <MiddleEllipsizedText
                      value={value}
                      color={valueColor}
                      weight="semibold"
                    />
                  ) : (
                    <AppText
                      variant="body"
                      weight="semibold"
                      numberOfLines={1}
                      ellipsizeMode={valueEllipsizeMode}
                      style={{ color: valueColor }}
                    >
                      {value}
                    </AppText>
                  )
                )
              ) : hasSubtitle ? subtitleContent ?? (
                <AppText
                  variant="caption"
                  tone={subtitleTone}
                  numberOfLines={subtitleMultiline ? undefined : 1}
                >
                  {subtitle}
                </AppText>
              ) : null}
            </View>

            {value && valuePlacement === 'trailing' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                maxWidth: VALUE_MAX_WIDTH, minWidth: 0,
                opacity: isInline && !disabled && !loading && (hovered || state.pressed) ? 0.7 : 1,
                flexShrink: preserveColumn === 'value' ? 0 : 1 }}>
                {valueLeading ? <View style={{ flexShrink: 0 }}>{valueLeading}</View> : null}
                {valueEllipsizeMode === 'middle' && !multilineValue ? (
                  <MiddleEllipsizedText
                    value={value}
                    color={valueColor}
                    weight="semibold"
                    style={{
                      flexShrink: preserveColumn === 'value' ? 0 : 1,
                    }}
                  />
                ) : (
                  <AppText
                    variant="body"
                    weight="semibold"
                    align="end"
                    numberOfLines={multilineValue ? undefined : 1}
                    ellipsizeMode={valueEllipsizeMode}
                    style={{
                      flexShrink: preserveColumn === 'value' ? 0 : 1,
                      color: valueColor,
                    }}
                  >
                    {value}
                  </AppText>
                )}
              </View>
            ) : null}

            {visibleTrailing ? (
              <View style={{ flexShrink: 0 }}>{visibleTrailing}</View>
            ) : null}
          </>
        );
      }}
    </Pressable>
  );
}
