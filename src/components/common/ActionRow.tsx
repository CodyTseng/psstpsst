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
  /** The main action — at inline end when horizontal and above the dismiss
   * action when stacked: `primary`, or `danger` when `destructive`. */
  confirm: Action & { destructive?: boolean };
  /** `lg` (default) for bottom-sheet footers and screen-bottom action areas;
   * `md` for the centered confirmation dialog. */
  size?: 'md' | 'lg';
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
  confirm,
  size = 'lg',
  layout,
}: Props) {
  const stacked = layout === 'vertical';
  const dismissButton = dismiss ? (
    <View style={stacked ? undefined : { flex: 1 }}>
      <AppButton
        label={dismiss.label}
        variant="secondary"
        size={size}
        loading={dismiss.loading}
        disabled={dismiss.disabled}
        onPress={dismiss.onPress}
      />
    </View>
  ) : null;
  const confirmButton = (
    <View style={!stacked ? { flex: 1 } : undefined}>
      <AppButton
        label={confirm.label}
        variant={confirm.destructive ? 'danger' : 'primary'}
        size={size}
        loading={confirm.loading}
        disabled={confirm.disabled}
        onPress={confirm.onPress}
      />
    </View>
  );

  return (
    <View style={{ flexDirection: stacked ? 'column' : 'row', gap: spacing.md }}>
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
