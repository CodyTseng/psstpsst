import { shortEmojiMessage } from '../short-message';

it('returns each complete emoji sequence separately', () => {
  expect(shortEmojiMessage('🫠🫠')).toEqual({
    content: '🫠🫠',
    count: 2,
    emojis: ['🫠', '🫠'],
  });
  expect(shortEmojiMessage('👩🏽‍💻 👩🏽‍💻')).toEqual({
    content: '👩🏽‍💻 👩🏽‍💻',
    count: 2,
    emojis: ['👩🏽‍💻', '👩🏽‍💻'],
  });
});

it('still rejects prose and more than three emoji', () => {
  expect(shortEmojiMessage('hello 👋')).toBeNull();
  expect(shortEmojiMessage('😀😀😀😀')).toBeNull();
});
