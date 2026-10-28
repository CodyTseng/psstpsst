import { nip19 } from 'nostr-tools';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MessagePreviewText } from '../MessagePreviewText';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; shortcodes?: string }) => {
      if (key === 'conversations.sticker_preview') {
        return `[Sticker] ${options?.shortcodes ?? ''}`;
      }
      if (key === 'conversations.sticker_preview_separator') return ', ';
      if (key === 'conversations.sender_preview') return `${options?.name}: `;
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
  it.each([5129, 15129, 35129, 15128, 35128, 35130])(
    'labels a shared application of kind %s in standalone and mixed previews',
    (kind) => {
      const reference = `nostr:${nip19.neventEncode({ id: 'ab'.repeat(32), kind })}`;
      for (const content of [reference, `Try ${reference}`, `:party: ${reference}`]) {
        const renderer = renderPreview(content, [['emoji', 'party', 'https://cdn.example/party.png']]);
        const serialized = JSON.stringify(renderer.toJSON());
        expect(serialized).toContain('conversations.application_reference_preview');
        expect(serialized).not.toContain('conversations.event_reference_preview');
      }
    },
  );

  it.each([35129, 35128, 35130])('labels an addressable application of kind %s', (kind) => {
    const reference = `nostr:${nip19.naddrEncode({ pubkey: 'ab'.repeat(32), kind, identifier: 'app' })}`;
    expect(JSON.stringify(renderPreview(reference).toJSON()))
      .toContain('conversations.application_reference_preview');
  });

  it('retains the event label for ordinary event references', () => {
    const reference = `nostr:${nip19.noteEncode('ab'.repeat(32))}`;
    expect(JSON.stringify(renderPreview(reference).toJSON()))
      .toContain('conversations.event_reference_preview');
  });

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

  it('prefixes a group preview with its sender inside the same truncated line', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        <MessagePreviewText content="Hello" senderName="Alice" />,
      );
    });

    const serialized = JSON.stringify(renderer!.toJSON());
    expect(serialized).toContain('Alice: ');
    expect(serialized).toContain('Hello');
  });
});
