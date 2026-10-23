import { create } from 'zustand';

/** Logical columns: primary is the list pane, detail is the content pane. */
export type ToastTarget = 'primary' | 'detail';

export type ToastVariant = 'default' | 'error';
export type ToastOptions = { target?: ToastTarget; variant?: ToastVariant };

type State = {
  /** The toast text, or null when hidden. */
  message: string | null;
  /** Bumped on each `show` so re-showing the same text re-triggers the timer. */
  id: number;
  target: ToastTarget | null;
  variant: ToastVariant;
  show: (message: string, options?: ToastOptions) => void;
  hide: () => void;
};

/**
 * A global toast: brief confirmation or error feedback shown over
 * whatever's on screen. Rendered once at the root by `Toast`, so it survives the
 * navigation that often triggers it (back out, then confirm).
 */
export const useToastStore = create<State>((set, get) => ({
  message: null,
  id: 0,
  target: null,
  variant: 'default',
  show: (message, options) => set({ message, target: options?.target ?? null, variant: options?.variant ?? 'default', id: get().id + 1 }),
  hide: () => set({ message: null, target: null, variant: 'default' }),
}));

/** Imperative helper for non-component callers. */
export function showToast(message: string, options?: ToastOptions) {
  useToastStore.getState().show(message, options);
}
