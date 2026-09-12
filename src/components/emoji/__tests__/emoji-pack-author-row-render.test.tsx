import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { EmojiPackAuthorRow } from '../EmojiPackAuthorRow';

let mockLanguage = 'en';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: mockLanguage },
  }),
}));

jest.mock('@/components/common/DirectionalChevron', () => ({
  DirectionalChevron: jest.fn(() => null),
}));

const mockDirectionalChevron = jest.requireMock(
  '@/components/common/DirectionalChevron',
).DirectionalChevron as jest.Mock;

jest.mock('@/components/common/InteractivePressable', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    InteractivePressable: ({ children, ...props }: {
      children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    }) => React.createElement(
      'Pressable',
      props,
      typeof children === 'function' ? children({ pressed: false }) : children,
    ),
  };
});

jest.mock('@/components/common/AppText', () => ({
  AppText: () => null,
}));

jest.mock('@/components/common/Avatar', () => ({
  Avatar: () => null,
}));

jest.mock('@/hooks/use-display-name', () => ({
  useDisplayName: () => ({ name: 'Author', profile: undefined }),
}));

jest.mock('@/theme', () => ({
  spacing: { sm: 8 },
  useThemeColors: () => ({ textMuted: 'gray' }),
}));

describe('EmojiPackAuthorRow', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockLanguage = 'en';
    mockDirectionalChevron.mockClear();
  });

  it.each([
    { language: 'en', translateX: -6 },
    { language: 'ar', translateX: 6 },
  ])('offsets the edge chevron toward the row interior for $language', (expected) => {
    mockLanguage = expected.language;

    act(() => {
      renderer = create(
        <EmojiPackAuthorRow authorPubkey="author" packTitle="Pack" />,
      );
    });

    expect(mockDirectionalChevron).toHaveBeenCalledWith(
      expect.objectContaining({
        style: { transform: [{ translateX: expected.translateX }] },
      }),
      undefined,
    );
  });
});
