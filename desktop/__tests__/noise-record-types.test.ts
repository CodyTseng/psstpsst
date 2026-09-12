import { validNoiseRecordType } from '../noise-record-types';

describe('Electron Noise record types', () => {
  it('accepts every Nearby file-transfer record in both Noise directions', () => {
    for (let type = 0x30; type <= 0x36; type += 1) {
      expect(validNoiseRecordType(type)).toBe(true);
    }
  });

  it('keeps unassigned record types rejected', () => {
    expect(validNoiseRecordType(0x2f)).toBe(false);
    expect(validNoiseRecordType(0x37)).toBe(false);
  });
});
