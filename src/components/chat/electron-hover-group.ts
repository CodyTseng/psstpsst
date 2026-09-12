/**
 * Tracks independently hovered sibling surfaces and closes only after every
 * surface has remained outside for the configured grace period.
 */
export class ElectronHoverGroup<Key> {
  private readonly hovered = new Set<Key>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly onLeaveAll: () => void,
  ) {}

  enter(key: Key) {
    this.hovered.add(key);
    this.cancelTimer();
  }

  leave(key: Key) {
    this.hovered.delete(key);
    this.cancelTimer();
    if (this.hovered.size > 0) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.hovered.size === 0) this.onLeaveAll();
    }, this.delayMs);
  }

  reset() {
    this.hovered.clear();
    this.cancelTimer();
  }

  private cancelTimer() {
    if (this.timer == null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
