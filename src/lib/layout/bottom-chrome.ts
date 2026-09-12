import { IS_ELECTRON } from '@/lib/platform';
import { bottomChrome } from '@/theme/layout';

/** Mobile bottom chrome keeps a small fallback inset when no home-indicator
 * inset is reported. Electron has no system bottom safe area, so its tab bar
 * and composer end at the window edge with no extra spacer. */
export function getBottomChromeInset(
  safeAreaBottom: number,
  isElectron = IS_ELECTRON,
): number {
  return isElectron ? 0 : Math.max(safeAreaBottom, bottomChrome.mobileFallbackInset);
}
