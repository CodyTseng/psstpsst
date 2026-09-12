import { router } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDirectionalIconStyle } from '@/i18n/direction';
import { iconStrokeWidth } from '@/theme/icons';
import { headerHeight, spacing, uiDensity, useThemeColors } from '@/theme';

import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { ChromeBackdrop } from './ChromeBackdrop';
import { ChromeDivider } from './ChromeDivider';

type Props = {
  /** Centered title. Omit for a bare back bar (e.g. over a large-title body). */
  title?: string;
  /** Optional centered interactive title control. Takes precedence over
   * `title`; use an `AppButton variant="text"` with `labelVariant="subtitle"`
   * (the wallet selector, DESIGN §8). */
  titleControl?: React.ReactNode;
  /** Defaults to `router.back()`. */
  onBack?: () => void;
  /** Optional trailing accessory (an `IconButton plain` or `AppButton
   * variant="text"`); balances the back chevron. */
  right?: React.ReactNode;
  /** Optional leading accessory for a tab root (e.g. the Nearby action). Only
   * used when `back` is false — a pushed screen's left slot is the Back chevron. */
  left?: React.ReactNode;
  /** Tab-root screens have no parent to pop to, so they hide the Back chevron
   * (the title stays centered, any `right` action stays on the right). */
  back?: boolean;
  /** Show the bottom hairline — for the iOS "border appears once content has
   * scrolled under the bar" cue. The caller drives it from scroll position
   * (see `useScrolled`); at rest it's borderless. The hairline overlays the
   * combined header bounds, so toggling it never shifts the body. */
  bordered?: boolean;
  /** Optional fixed chrome rendered directly below the title row. */
  below?: React.ReactNode;
  /** Exact height reserved for `below`. */
  belowHeight?: number;
  /** Remove the chrome backdrop and use overlay foregrounds above media. */
  overMedia?: boolean;
  /** Additional top clearance reserved for platform-owned window controls. */
  topOffset?: number;
};

/** Total content clearance for the status area, title row, and optional lower chrome. */
export function useScreenHeaderClearance(belowHeight = 0) {
  return headerHeight + useSafeAreaInsets().top + belowHeight;
}

/**
 * The one navigation bar for **every screen** — pushed pages (New chat, Add
 * contact, Servers, …) and the **tab roots** (Chats, Contacts, Settings). iOS
 * navigation-bar style: a centered `subtitle` title (true screen center,
 * independent of the accessory widths), with the Back chevron on the left
 * (`back`, default true) and optional side actions. Tab roots pass
 * `back={false}`; their primary page action goes in `right`. The Back control is
 * a `compact` ghost pill with the chevron in the normal text color. (DESIGN §8.)
 */
export function ScreenHeader({
  title,
  titleControl,
  onBack,
  right,
  left,
  back = true,
  bordered,
  below,
  belowHeight = 0,
  overMedia = false,
  topOffset = 0,
}: Props) {
  const c = useThemeColors();
  const directionalIconStyle = useDirectionalIconStyle();
  const insets = useSafeAreaInsets();
  const topInset = insets.top;
  return (
    <View
      style={{
        height: headerHeight + topInset + belowHeight,
        position: 'absolute',
        top: topOffset,
        start: 0,
        end: 0,
        zIndex: 1,
      }}
    >
      {overMedia ? null : (
        <ChromeBackdrop frosted={bordered === true} scrollbarOcclusion="top" />
      )}
      <View
        style={[styles.passThrough, {
          position: 'absolute',
          top: topInset,
          start: 0,
          end: 0,
          height: headerHeight,
          justifyContent: 'center',
        }]}
      >
        {titleControl || title ? (
          <View
            style={[titleControl ? styles.passThrough : styles.nonInteractive, {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
              // Keep the centered title clear of the side accessories.
              paddingHorizontal: 72,
            }]}
          >
            {titleControl ? (
              // `AppButton fullWidth={false}` hugs its content with
              // `alignSelf: flex-start`; this shrink-wrapping parent is what
              // centres that control against the full screen.
              <View style={{ maxWidth: '100%', alignSelf: 'center' }}>{titleControl}</View>
            ) : (
              <AppText
                variant="subtitle"
                weight="semibold"
                numberOfLines={1}
                style={{ color: overMedia ? c.onOverlay : c.text, userSelect: 'none' }}
              >
                {title}
              </AppText>
            )}
          </View>
        ) : null}

        <View
          style={[styles.passThrough, {
            position: 'absolute',
            top: 0,
            bottom: 0,
            start: 0,
            end: 0,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            // Accessory button edges sit on the 8px header rail. Their internal
            // 8px inset places visible icons on the page's 16px content gutter.
            // A tab root without a left action keeps its empty slot on the
            // ordinary 16px page gutter.
            paddingStart: back || left ? spacing.sm : spacing.lg,
            paddingEnd: spacing.sm,
          }]}
        >
          {back ? (
            // Wrapped in a plain View so the pill's content-hug `alignSelf:
            // flex-start` doesn't pin it to the row's top (see DESIGN §8).
            <View>
              <AppButton
                variant="ghost"
                fullWidth={false}
                corner="full"
                compact
                onPress={onBack ?? (() => router.back())}
                accessibilityLabel="Back"
                iconLeft={
                  <ChevronLeft
                    strokeWidth={iconStrokeWidth.default}
                    size={uiDensity.headerActionIconSize}
                    color={overMedia ? c.onOverlay : c.text}
                    style={directionalIconStyle}
                  />
                }
              />
            </View>
          ) : (
            // Tab root: an optional leading accessory (e.g. Nearby),
            // else an empty slot so `space-between` still parks `right` on the right.
            left ?? <View />
          )}
          {/* Like the Back control, keep content-hugging AppButtons inside a
              plain wrapper. Their `alignSelf: flex-start` then controls width in
              the wrapper instead of overriding this row's vertical centring. */}
          {right ? (
            <View style={{ height: uiDensity.headerActionSize, justifyContent: 'center' }}>
              {right}
            </View>
          ) : null}
        </View>
      </View>
      {below && belowHeight > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: topInset + headerHeight,
            start: 0,
            end: 0,
            height: belowHeight,
          }}
        >
          {below}
        </View>
      ) : null}
      <ChromeDivider visible={bordered === true} />
    </View>
  );
}

// React Native Web compiles box-none into CSS child selectors only for
// registered styles; an inline box-none value leaves the overlay hit-testable.
const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'box-none' },
  nonInteractive: { pointerEvents: 'none' },
});
