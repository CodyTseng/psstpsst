import { formatCustomDate, normalizeCustomDateFormat } from '../date-format';

const date = new Date(2026, 0, 5);

it.each([
  ['YYYY/MM/DD', '2026/01/05'], ['D.M.YYYY', '5.1.2026'],
  ['MM/DD/YY', '01/05/26'], ['DD MM YYYY', '05 01 2026'],
  ['YYYY年M月D日', '2026年1月5日'], ['YYYYMMDD', '20260105'],
  ['YY-M-D', '26-1-5'],
])('formats %s as %s', (pattern, expected) => {
  expect(normalizeCustomDateFormat(pattern)).toBe(pattern);
  expect(formatCustomDate(date, pattern)).toBe(expected);
});

it.each(['YYYY/MM', 'DD/MM/YYYY/YYYY', 'DD/DD/YYYY', 'yyyy/MM/dd', 'YYYY/MMM/DD', 'YYYY/MM/DD HH:mm', 'YYYY\nMM/DD', 'YYYY/MM/\u202eDD', '', 'Y'.repeat(41), null, {}])('rejects invalid pattern %p', pattern => {
  expect(normalizeCustomDateFormat(pattern)).toBeNull();
});

it('trims the input and preserves leap days and calendar years', () => {
  expect(normalizeCustomDateFormat(' YYYY/MM/DD ')).toBe('YYYY/MM/DD');
  expect(formatCustomDate(new Date(2024, 1, 29), 'D/M/YY')).toBe('29/2/24');
  expect(formatCustomDate(new Date(2025, 11, 31), 'YYYY-MM-DD')).toBe('2025-12-31');
});
