import { resolveNearbySignalTier } from '@/services/proximity/nearby-signal-tier';

describe('Nearby signal tiers', () => {
  it('classifies a new discovery into coarse RSSI tiers', () => {
    expect(resolveNearbySignalTier(-45)).toBe('strong');
    expect(resolveNearbySignalTier(-60)).toBe('medium');
    expect(resolveNearbySignalTier(-80)).toBe('weak');
  });

  it('keeps the current tier through normal boundary noise', () => {
    expect(resolveNearbySignalTier(-59, 'strong')).toBe('strong');
    expect(resolveNearbySignalTier(-51, 'medium')).toBe('medium');
    expect(resolveNearbySignalTier(-71, 'medium')).toBe('medium');
    expect(resolveNearbySignalTier(-66, 'weak')).toBe('weak');
  });

  it('changes tiers after a signal crosses the hysteresis boundary', () => {
    expect(resolveNearbySignalTier(-61, 'strong')).toBe('medium');
    expect(resolveNearbySignalTier(-49, 'medium')).toBe('strong');
    expect(resolveNearbySignalTier(-76, 'medium')).toBe('weak');
    expect(resolveNearbySignalTier(-64, 'weak')).toBe('medium');
  });

  it('skips an intermediate tier for a large signal change', () => {
    expect(resolveNearbySignalTier(-80, 'strong')).toBe('weak');
    expect(resolveNearbySignalTier(-45, 'weak')).toBe('strong');
  });
});
