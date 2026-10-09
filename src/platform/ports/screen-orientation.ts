/** Viewer rotation temporarily overrides the normal phone/tablet policy. */
export interface ScreenOrientationPort {
  setVideoActive(active: boolean): Promise<void>;
}
