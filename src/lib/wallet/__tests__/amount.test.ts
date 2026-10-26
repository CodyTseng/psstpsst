import { satsFromMsat } from '../amount';
it.each([[1, '0.001'], [1234, '1.234'], [1000, '1'], [Number.MAX_SAFE_INTEGER, '9007199254740.991']])('formats exact msats: %s', (value, expected) => {
  expect(satsFromMsat(value as number)).toBe(expected);
});
