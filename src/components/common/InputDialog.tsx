import { type ReactNode } from 'react';

import { contentWidth } from '@/theme';

import { ActionRow, type ActionRowLayout } from './ActionRow';
import { AppText } from './AppText';
import { DialogSurface } from './DialogSurface';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Fired once the dialog has closed (there is no exit animation, so this is
   * the `visible` flip). Mirrors `BottomSheet.onClosed` so callers can chain a
   * follow-up modal the same way on every platform. */
  onClosed?: () => void;
  /** Centered above the field(s). Omit when the summoning row already named
   * the value being edited. */
  title?: string;
  /** Declared by the caller alongside its localized action labels. */
  actionLayout: ActionRowLayout;
  confirmLabel: string;
  /** Omit for a single-action dialog whose dismissal is implicit
   * (backdrop tap / Escape). */
  cancelLabel?: string;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  onConfirm: () => void;
  /** Wider registered task dialogs may opt into another content-width token. */
  maxWidth?: number;
  /** The entry field(s) — `AppInput` plus the field-adjacent helper/error
   * caption (below the field, start-aligned; see DESIGN §8). */
  children?: ReactNode;
};

/**
 * The centered value-entry dialog (DESIGN §8) — Electron's form for a
 * small single-purpose entry that mobile presents as a bottom sheet. Shares
 * the confirmation dialog's chrome (DESIGN §8): centered elevated card,
 * dimmed backdrop, `ActionRow` at dialog size. Backdrop tap, Escape, and
 * Android back cancel; the field's own `onSubmitEditing` confirms.
 */
export function InputDialog({
  visible,
  onClose,
  onClosed,
  title,
  actionLayout,
  confirmLabel,
  cancelLabel,
  confirmDisabled,
  confirmLoading,
  onConfirm,
  maxWidth = contentWidth.dialog,
  children,
}: Props) {
  return (
    <DialogSurface
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      accessibilityLabel={cancelLabel}
      maxWidth={maxWidth}
    >
      {title != null ? (
        <AppText variant="subtitle" align="center">
          {title}
        </AppText>
      ) : null}
      {children}
      <ActionRow
        size="md"
        layout={actionLayout}
        dismiss={cancelLabel != null ? { label: cancelLabel, onPress: onClose } : undefined}
        confirm={{
          label: confirmLabel,
          onPress: onConfirm,
          disabled: confirmDisabled,
          loading: confirmLoading,
        }}
      />
    </DialogSurface>
  );
}
