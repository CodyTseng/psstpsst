import { create } from 'zustand';

type State = {
  /** The toast text, or null when hidden. */
  message: string | null;
  /** Bumped on each `show` so re-showing the same text re-triggers the timer. */
  id: number;
  show: (message: string) => void;
  hide: () => void;
};

/**
 * A tiny global toast: a brief confirmation message (e.g. "Sent") shown over
 * whatever's on screen. Rendered once at the root by `Toast`, so it survives the
 * navigation that often triggers it (back out, then confirm).
 */
export const useToastStore = create<State>((set, get) => ({
  message: null,
  id: 0,
  show: (message) => set({ message, id: get().id + 1 }),
  hide: () => set({ message: null }),
}));

/** Imperative helper for non-component callers. */
export function showToast(message: string) {
  useToastStore.getState().show(message);
}
