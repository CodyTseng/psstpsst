import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import OpenSource from '@/app/(app)/open-source';
import OpenSourceProject from '@/app/(app)/open-source-project';
import { AppText } from '@/components/common/AppText';
import { ListRow } from '@/components/common/ListRow';
import { SearchBar } from '@/components/search/SearchBar';
import { LicenseState } from '../LicenseState';
import { darkPalette, lightPalette } from '@/theme';
import { useLicenseBrowserStore } from '@/stores/license-browser.store';

let mockScheme: 'light' | 'dark' = 'light';
let mockId = 'test-id';
let mockLanguage = 'en';
const mockProject = { id: 'test-id', name: '@example/project', version: '1.0.0', license: 'MIT',
  repository: 'https://github.com/example/project', documents: [{ id: 'notice', title: 'LICENSE' }] };
const mockCatalog = { projects: [mockProject], byId: new Map([[mockProject.id, mockProject]]),
  search: new Map([[mockProject.id, '@example/project 1.0.0 mit']]) };

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: object) => unknown) => selector({ accent: 'blue', preference: mockScheme }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string) => key, i18n: { resolvedLanguage: mockLanguage },
}) }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: mockId }),
}));
jest.mock('@/hooks/use-licenses', () => ({
  useLicenseCatalog: () => ({ catalog: mockCatalog, error: false, retry: jest.fn() }),
  useProjectNotices: (project: unknown) => ({ chunks: project ? [{ key: '0', title: 'LICENSE', text: 'Copyright Example. Permission granted.' }] : undefined }),
}));
jest.mock('@solar-icons/react-native/category/notes/Linear/DocumentText', () => ({ DocumentText: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/arrows/Linear/SquareArrowRightUp', () => ({ SquareArrowRightUp: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/chevron-left', () => () => null, { virtual: true });
jest.mock('lucide-react-native/icons/chevron-right', () => () => null, { virtual: true });
jest.mock('@solar-icons/react-native/category/search/Linear/Magnifer', () => ({ Magnifer: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/x', () => () => null, { virtual: true });
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual<typeof import('react-native')>('react-native').View },
  FadeIn: { duration: () => undefined },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual<typeof import('react-native')>('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/platform', () => ({ platform: {} }));

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); useLicenseBrowserStore.setState({ query: '' }); jest.clearAllMocks(); mockId = 'test-id'; mockLanguage = 'en'; });

it.each(['light', 'dark'] as const)('renders searchable catalog and readable details in %s mode', (scheme) => {
  mockScheme = scheme;
  act(() => { renderer = create(<OpenSource />); });
  const backgrounds = renderer.root.findAllByType(View).map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor);
  expect(backgrounds).toContain((scheme === 'dark' ? darkPalette : lightPalette).background);
  const row = renderer.root.findAllByType(ListRow).find((node) => node.props.title === mockProject.name)!;
  act(() => { row.props.onPress(); });
  expect(router.push).toHaveBeenCalledWith({ pathname: '/open-source-project', params: { id: mockProject.id } });
  act(() => { renderer.root.findByType(SearchBar).props.onChangeText('does not exist'); });
  expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
  expect(renderer.root.findByType(LicenseState).props.title).toBe('licenses.no_results');
  act(() => renderer.update(<OpenSourceProject />));
  const notice = renderer.root.findAllByType(AppText).find((node) => node.props.children === 'Copyright Example. Permission granted.')!;
  expect(notice.props.selectable).toBe(true);
  expect(notice.props.language).toBe('en');
});

it('shows an explicit missing-project state for invalid route IDs', () => {
  mockId = 'missing';
  act(() => { renderer = create(<OpenSourceProject />); });
  expect(renderer.root.findByType(LicenseState).props.title).toBe('licenses.not_found');
});

it('keeps verbatim English notices start-aligned in an RTL app locale', () => {
  mockLanguage = 'ar';
  act(() => { renderer = create(<AppText language="en" selectable>Copyright Example</AppText>); });
  const text = renderer.root.findAllByType('Text' as never).find((node) => node.props.lang === 'en');
  expect(text).toBeDefined();
  expect(StyleSheet.flatten(text!.props.style).textAlign).toBe('left');
});
