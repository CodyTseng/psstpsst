export type ConfirmationDialogOptions = {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Electron presentation only. Defaults to the compact horizontal pair. */
  actionLayout?: 'horizontal' | 'vertical';
};

export type NoticeDialogOptions = {
  title: string;
  message?: string;
  okLabel: string;
};

/**
 * Platform modal dialogs. React Native Web's `Alert` is a no-op, so every
 * `Alert.alert` decision or notice must go through this port to stay visible
 * on desktop.
 */
export interface ConfirmationDialogPort {
  /** Short, destructive decisions; resolves the user's boolean choice. */
  confirm(options: ConfirmationDialogOptions): Promise<boolean>;
  /** Single-button informational notice; resolves once dismissed. */
  notify(options: NoticeDialogOptions): Promise<void>;
}
