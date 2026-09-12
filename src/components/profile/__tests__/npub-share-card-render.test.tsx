import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { radius } from '@/theme';

import { NpubShareCard } from '../NpubShareCard';

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en' } }),
}));

jest.mock('../NpubQrCode', () => ({
  NpubQrCode: () => null,
}));

describe('NpubShareCard export layout', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('keeps the preview rounded while the captured card is square', () => {
    act(() => {
      renderer = create(
        <NpubShareCard
          npub="npub1abcdefghijklmnopqrstuvwxyz"
          name="Cody"
          nip05="cody@psstpsst.chat"
        />,
      );
    });

    const views = renderer!.root.findAllByType(View);
    expect(StyleSheet.flatten(views[0].props.style)).toMatchObject({
      borderRadius: radius['2xl'],
      overflow: 'hidden',
    });
    expect(StyleSheet.flatten(views[1].props.style)).not.toHaveProperty('borderRadius');
    expect(StyleSheet.flatten(views[2].props.style)).toMatchObject({
      borderRadius: radius.xl,
    });

    const [name, nip05] = renderer!.root.findAllByType(AppText);
    expect(name.props.numberOfLines).toBeUndefined();
    expect(nip05.props.numberOfLines).toBeUndefined();
  });
});
