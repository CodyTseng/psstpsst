import { getDerivedGroupTitleNameLimit } from '../group-presentation-model';

describe('getDerivedGroupTitleNameLimit', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 2],
    [5, 3],
    [6, 3],
  ])('for %i members, shows %i names', (memberCount, expected) => {
    expect(getDerivedGroupTitleNameLimit(memberCount)).toBe(expected);
  });
});
