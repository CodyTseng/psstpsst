import { View } from 'react-native';

import { AppButton } from './AppButton';
import { spacing } from '@/theme';

type Action = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export type ActionRowLayout = 'horizontal' | 'vertical';

type Props = {
  /** Cancel/decline action — at inline start when horizontal and below the
   * confirm action when stacked; always `secondary`.
   * Omit only for a single-action sheet whose dismissal is implicit
   * (backdrop tap / swipe); a destructive confirm must never stand alone
   * (DESIGN §8). */
  dismiss?: Action;
  /** Independent alternative, placed at inline-start in compact desktop rows. */
  auxiliary?: Action;
  /** Desktop utility actions hug their labels and retain a compact corner. */
  compact?: boolean;
  /** The main action — at inline end when horizontal and above the dismiss
   * action when stacked: `primary`, or `danger` when `destructive`. */
  confirm: Action & { destructive?: boolean };
  /** `lg` (default) for bottom-sheet footers and screen-bottom action areas;
   * `md` for the centered confirmation dialog. */
  size?: 'sm' | 'md' | 'lg';
  /** Declared action arrangement. The layout never reflows after mount. */
  layout: ActionRowLayout;
};

/**
 * The one action-group layout (DESIGN §8). Every dialog/sheet/screen-bottom
 * pair or lone action goes through this — never a hand-rolled row of
 * `AppButton`s. The caller declares the pair's arrangement from its known
 * labels and surface; it never changes after mount. Variants are derived here
 * (dismiss → `secondary`, confirm → `primary` / `danger`), never chosen by
 * the caller.
 */
export function ActionRow({
  dismiss,
  auxiliary,
  compact = false,
  confirm,
  size = 'lg',
  layout,
}: Props) {
  const stacked = layout === 'vertical';
  const dismissButton = dismiss ? (
    <View style={stacked || compact ? undefined : { flex: 1 }}>
      <AppButton
        label={dismiss.label}
        variant="secondary"
        size={size}
        corner={compact ? 'sm' : 'lg'}
        fullWidth={!compact}
        loading={dismiss.loading}
        disabled={dismiss.disabled}
        onPress={dismiss.onPress}
      />
    </View>
  ) : null;
  const confirmButton = (
    <View style={!stacked && !compact ? { flex: 1 } : undefined}>
      <AppButton
        label={confirm.label}
        variant={confirm.destructive ? 'danger' : 'primary'}
        size={size}
        corner={compact ? 'sm' : 'lg'}
        fullWidth={!compact}
        loading={confirm.loading}
        disabled={confirm.disabled}
        onPress={confirm.onPress}
      />
    </View>
  );

  return (
    <View style={{ flexDirection: stacked ? 'column' : 'row', gap: compact ? spacing.sm : spacing.md,
      ...(compact ? { alignItems: 'center', justifyContent: 'flex-end' } : {}) }}>
      {auxiliary ? <View style={compact && !stacked ? { marginEnd: 'auto' } : undefined}>
        <AppButton label={auxiliary.label} variant="secondary" size={size} corner={compact ? 'sm' : 'lg'}
          fullWidth={!compact} loading={auxiliary.loading} disabled={auxiliary.disabled} onPress={auxiliary.onPress} />
      </View> : null}
      {stacked ? (
        <>
          {confirmButton}
          {dismissButton}
        </>
      ) : (
        <>
          {dismissButton}
          {confirmButton}
        </>
      )}
    </View>
  );
}
