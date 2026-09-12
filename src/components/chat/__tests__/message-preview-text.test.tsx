import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MessagePreviewText } from '../MessagePreviewText';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { shortcodes?: string }) => {
      if (key === 'conversations.sticker_preview') {
        return `[Sticker] ${options?.shortcodes ?? ''}`;
      }
      if (key === 'conversations.sticker_preview_separator') return ', ';
      return key;
    },
  }),
}));

jest.mock('@/hooks/use-display-name', () => ({
  useDisplayName: () => ({ name: 'Alice' }),
}));

jest.mock('@/components/common/AppText', () => {
  const { Text } = jest.requireActual('react-native') as typeof import('react-native');
  return { AppText: Text };
});

function renderPreview(content: string, tags?: string[][]): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<MessagePreviewText content={content} tags={tags} />);
  });
  return renderer!;
}

describe('MessagePreviewText', () => {
  it('renders one Sticker label followed by bare shortcodes for a sticker-only message', () => {
    const renderer = renderPreview(':party: :wave:', [
      ['emoji', 'party', 'https://cdn.example/party.png'],
      ['emoji', 'wave', 'https://cdn.example/wave.gif'],
    ]);

    expect(renderer.root.findByType('Text' as never).props.children).toBe(
      '[Sticker] party, wave',
    );
  });

  it('replaces an authenticated inline shortcode without colons', () => {
    const renderer = renderPreview('Hello :party:', [
      ['emoji', 'party', 'https://cdn.example/party.png'],
    ]);

    const serialized = JSON.stringify(renderer.toJSON());
    expect(serialized).toContain('Hello ');
    expect(serialized).toContain('[Sticker] party');
    expect(serialized).not.toContain(':party:');
  });

  it('keeps an untagged shortcode as text', () => {
    const renderer = renderPreview(':party:');

    expect(renderer.root.findByType('Text' as never).props.children).toBe(':party:');
  });
});
