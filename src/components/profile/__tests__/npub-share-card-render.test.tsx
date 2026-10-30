import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { radius } from '@/theme';
import { createThemePalettes } from '@/theme/palette';
import type { AccentSelection } from '@/theme/accents';
import { NpubQrCode } from '../NpubQrCode';

import { NpubShareCard } from '../NpubShareCard';

let mockScheme: 'light' | 'dark' = 'light';
let mockAccent: AccentSelection = 'blue';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: object) => unknown) =>
    selector({ accent: mockAccent, preference: mockScheme, palettes: jest.requireActual('@/theme/palette').createThemePalettes(mockAccent) }),
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

it.each(['light', 'dark'] as const)('uses the global foreground for the QR tile and secondary identity text in %s mode', (scheme) => {
  mockScheme = scheme;
  mockAccent = { light: { color: '#FFFF00', foreground: 'black' } };
  const c = createThemePalettes(mockAccent)[scheme];
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NpubShareCard npub="npub1test" name="Name" nip05="name@example.com" />); });
  const views = renderer.root.findAllByType(View);
  expect(StyleSheet.flatten(views[1].props.style).backgroundColor).toBe(c.accent);
  expect(StyleSheet.flatten(views[2].props.style).backgroundColor).toBe(c.accentForeground);
  expect(renderer.root.findByType(NpubQrCode).props.color).toBe(c.accent);
  const [name, identifier, publicKey] = renderer.root.findAllByType(AppText);
  expect(name.props.style.color).toBe(c.accentForeground);
  expect(identifier.props.style.color).toBe(c.accentForegroundMuted);
  expect(publicKey.props.style.color).toBe(c.accentForegroundMuted);
  act(() => renderer.unmount());
  mockAccent = 'blue';
  mockScheme = 'light';
});
