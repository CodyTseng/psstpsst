import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';

import { Nip05Label } from '../Nip05Label';

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

jest.mock('@/lib/nostr/nip05', () => ({
  queryNip05Profile: jest.fn(() => new Promise(() => {})),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en' } }),
}));

jest.mock(
  '@solar-icons/react-native/category/money/Linear/VerifiedCheck',
  () => ({ VerifiedCheck: () => null }),
  { virtual: true },
);

jest.mock('lucide-react-native/icons/circle-question-mark', () => () => null);

describe('Nip05Label layout', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('truncates both identifier segments without shrinking the status icon', () => {
    act(() => {
      renderer = create(
        <Nip05Label
          nip05="a-very-long-local-name@a-very-long-domain.example"
          pubkey="pubkey"
        />,
      );
    });

    const root = renderer!.root.findAllByType(View)[0];
    const [local, domain] = renderer!.root.findAllByType(AppText);
    const badgeContainer = root.findAllByType(View)[1];

    expect(root.props.style).toMatchObject({ flexShrink: 1, minWidth: 0 });
    for (const segment of [local, domain]) {
      expect(segment.props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'tail' });
      expect(segment.props.style).toMatchObject({ flexShrink: 1, minWidth: 0 });
    }
    expect(badgeContainer.props.style).toMatchObject({ flexShrink: 0 });
  });
});
