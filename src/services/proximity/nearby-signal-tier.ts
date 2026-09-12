export type NearbySignalTier = 'strong' | 'medium' | 'weak';

const STRONG_RSSI = -55;
const MEDIUM_RSSI = -70;
const HYSTERESIS_DB = 5;

/**
 * Converts smoothed RSSI into a coarse proximity tier. Existing discoveries
 * need to cross a wider boundary before changing tier so radio noise does not
 * continuously reorder interactive rows.
 */
export function resolveNearbySignalTier(
  rssi: number,
  currentTier?: NearbySignalTier,
): NearbySignalTier {
  if (currentTier == null) {
    if (rssi >= STRONG_RSSI) return 'strong';
    if (rssi >= MEDIUM_RSSI) return 'medium';
    return 'weak';
  }

  switch (currentTier) {
    case 'strong':
      if (rssi < MEDIUM_RSSI - HYSTERESIS_DB) return 'weak';
      if (rssi < STRONG_RSSI - HYSTERESIS_DB) return 'medium';
      return 'strong';
    case 'medium':
      if (rssi >= STRONG_RSSI + HYSTERESIS_DB) return 'strong';
      if (rssi < MEDIUM_RSSI - HYSTERESIS_DB) return 'weak';
      return 'medium';
    case 'weak':
      if (rssi >= STRONG_RSSI + HYSTERESIS_DB) return 'strong';
      if (rssi >= MEDIUM_RSSI + HYSTERESIS_DB) return 'medium';
      return 'weak';
  }
}
