import { toastKeyboardTranslateY } from '../toast-keyboard-position';

it('does not move the toast while the keyboard is hidden', () => {
  expect(toastKeyboardTranslateY(0, 0, 34)).toBe(0);
});

it('lifts the toast by keyboard height without duplicating the safe area', () => {
  expect(toastKeyboardTranslateY(-300, 1, 34)).toBe(-266);
});

it('tracks an interactive keyboard transition', () => {
  expect(toastKeyboardTranslateY(-150, 0.5, 34)).toBe(-133);
});
