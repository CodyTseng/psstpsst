import type {
  ConfirmationDialogOptions,
  NoticeDialogOptions,
} from './ports/confirmation-dialog';

/**
 * A renderer-side dialog presenter. On platforms whose native dialog cannot
 * express the design system's button roles (Electron: NSAlert/message boxes
 * can't tint a destructive button), the root-mounted UI host registers itself
 * here and the platform adapter prefers it over the native bridge. Pure
 * module state — the platform layer never imports the UI host itself.
 */
export interface DialogPresenter {
  confirm(options: ConfirmationDialogOptions): Promise<boolean>;
  notify(options: NoticeDialogOptions): Promise<void>;
}

let presenter: DialogPresenter | null = null;

export function registerDialogPresenter(next: DialogPresenter | null): void {
  presenter = next;
}

export function getDialogPresenter(): DialogPresenter | null {
  return presenter;
}
