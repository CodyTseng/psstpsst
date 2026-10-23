import { metadataFilters } from '../metadata-batch';

it('requests several authors follow lists in one filter with a sufficient result limit', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  expect(metadataFilters([{ pubkey: a, kind: 3 }, { pubkey: b, kind: 3 }, { pubkey: a, kind: 3 }])).toEqual([
    [{ kinds: [3], authors: [a, b], limit: 2 }],
  ]);
});

it('does not broaden different kinds into unwanted author and kind combinations', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  expect(metadataFilters([{ pubkey: a, kind: 3 }, { pubkey: b, kind: 3 }, { pubkey: b, kind: 0 }])).toEqual([
    [{ kinds: [3], authors: [a, b], limit: 2 }, { kinds: [0], authors: [b], limit: 1 }],
  ]);
});
