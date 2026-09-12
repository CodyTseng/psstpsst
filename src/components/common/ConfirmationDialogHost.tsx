import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { ActionRow } from '@/components/common/ActionRow';
import { AppText } from '@/components/common/AppText';
import { IS_ELECTRON } from '@/lib/platform';
import type { ConfirmationDialogOptions, NoticeDialogOptions } from '@/platform';
import { registerDialogPresenter } from '@/platform/dialog-presenter';
import { contentWidth, radius, shadow, spacing, useThemeColors } from '@/theme';

type PendingDialog =
  | {
      kind: 'confirm';
      options: ConfirmationDialogOptions;
      resolve: (confirmed: boolean) => void;
    }
  | { kind: 'notify'; options: NoticeDialogOptions; resolve: () => void };

/**
 * The Electron confirmation/notice dialog (rendered once at the root). The
 * native main-process message box cannot express the design system's button
 * roles — a destructive confirm must read `danger` — so on Electron the
 * confirmationDialog port is presented here instead. Button roles come from
 * the shared `ActionRow` (DESIGN §8) at dialog size: the confirm action is
 * `danger` when `destructive`, `primary` otherwise; cancel is `secondary`; a
 * notice's single button is `primary`.
 * Backdrop click, Escape, and Android back cancel; Enter confirms. Calls are
 * queued FIFO so a second dialog never replaces one still on screen.
 */
export function ConfirmationDialogHost() {
  const c = useThemeColors();
  const [queue, setQueue] = useState<PendingDialog[]>([]);
  const current = queue[0];
  // Identity guard against a double tap settling one dialog twice (which
  // would also drop the next queued dialog).
  const settlingRef = useRef<PendingDialog | null>(null);

  useEffect(() => {
    if (!IS_ELECTRON) return;
    registerDialogPresenter({
      confirm: (options) =>
        new Promise((resolve) => {
          setQueue((q) => [...q, { kind: 'confirm', options, resolve }]);
        }),
      notify: (options) =>
        new Promise((resolve) => {
          setQueue((q) => [...q, { kind: 'notify', options, resolve }]);
        }),
    });
    return () => registerDialogPresenter(null);
  }, []);

  const settle = useCallback(
    (confirmed: boolean) => {
      if (!current || settlingRef.current === current) return;
      settlingRef.current = current;
      if (current.kind === 'confirm') current.resolve(confirmed);
      else current.resolve();
      setQueue((q) => q.filter((dialog) => dialog !== current));
    },
    [current],
  );

  useEffect(() => {
    // `document` exists on Electron (the only platform this host renders on);
    // the typeof guard keeps non-DOM environments (tests) safe.
    if (!IS_ELECTRON || !current || typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false);
      if (event.key === 'Enter') settle(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [current, settle]);

  if (!IS_ELECTRON || !current) return null;

  const dialog = current;
  const { options } = dialog;
  const dismissLabel =
    dialog.kind === 'confirm' ? dialog.options.cancelLabel : dialog.options.okLabel;

  return (
    <Modal transparent visible onRequestClose={() => settle(false)} statusBarTranslucent>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.overlay,
          padding: spacing.xl,
        }}
      >
        <Pressable
          hoverFeedback={false}
          style={StyleSheet.absoluteFill}
          onPress={() => settle(false)}
          accessibilityLabel={dismissLabel}
        />
        <View
          style={{
            width: '100%',
            maxWidth: contentWidth.dialog,
            padding: spacing.lg,
            borderRadius: radius.xl,
            backgroundColor: c.surfaceElevated,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            ...shadow.float,
          }}
        >
          <AppText variant="subtitle" align="center">
            {options.title}
          </AppText>
          {options.message ? (
            <AppText
              variant="body"
              tone="muted"
              align="center"
              style={{ marginTop: spacing.xs }}
            >
              {options.message}
            </AppText>
          ) : null}
          <View style={{ marginTop: spacing.lg }}>
            {dialog.kind === 'confirm' ? (
              <ActionRow
                size="md"
                layout={dialog.options.actionLayout ?? 'horizontal'}
                dismiss={{ label: dialog.options.cancelLabel, onPress: () => settle(false) }}
                confirm={{
                  label: dialog.options.confirmLabel,
                  destructive: dialog.options.destructive,
                  onPress: () => settle(true),
                }}
              />
            ) : (
              <ActionRow
                size="md"
                layout="vertical"
                confirm={{ label: dialog.options.okLabel, onPress: () => settle(true) }}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
