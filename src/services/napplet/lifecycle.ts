/** Account lifecycle must not eagerly load the renderer or application runtime. */
let stop: ((account?: string) => void) | undefined;
export function registerNappletLifecycle(listener: (account?: string) => void) {
  stop = listener;
}
export const nappletLifecycle = {
  deactivate() {
    stop?.();
  },
  removing(account: string) {
    stop?.(account);
  },
};
