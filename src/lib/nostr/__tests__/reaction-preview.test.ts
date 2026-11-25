import { parseReactionPreview } from '../reaction-preview';

it.each([
  ['+', '👍'],
  ['', '👍'],
  ['-', '👎'],
  ['❤', '❤️'],
  ['👩🏾‍💻', '👩🏾‍💻'],
])('renders the reaction %s as one emoji', (content, emoji) => {
  expect(parseReactionPreview(content, [])).toEqual({ emoji });
});

it('uses generic copy for a tagged custom emoji and rejects untagged or arbitrary text', () => {
  expect(parseReactionPreview(':wave:', [['emoji', 'wave', 'https://images.example/wave.png']])).toEqual({ emoji: null });
  expect(parseReactionPreview(':wave:', [])).toBeNull();
  expect(parseReactionPreview('text 👍', [])).toBeNull();
  expect(parseReactionPreview('👍👍', [])).toBeNull();
});
