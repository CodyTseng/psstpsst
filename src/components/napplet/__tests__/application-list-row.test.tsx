import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationListRow } from '../ApplicationListRow';
import { ApplicationInfo } from '../NappletInfo';
import { ApplicationIdentity } from '../ApplicationIdentity';
import { RunningApplicationIcon } from '../RunningApplicationIcon';
import { ListRow } from '@/components/common/ListRow';
import { AppText } from '@/components/common/AppText';
import { spacing } from '@/theme';
import type { ApplicationListEntry } from '@/services/explore/model';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme'), useEffectiveColorScheme: () => mockScheme,
  useThemeColors: () => jest.requireActual('@/theme')[mockScheme === 'light' ? 'lightPalette' : 'darkPalette'],
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: () => ({ name: 'Alice', profile: null }) }));
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: ({ icon, subtitleContent }: { icon?: React.ReactNode; subtitleContent?: React.ReactNode }) => <>{icon}{subtitleContent}</> }));
jest.mock('@/components/napplet/RunningApplicationIcon', () => ({ RunningApplicationIcon: 'Icon' }));
jest.mock('@/components/napplet/ApplicationIdentity', () => ({ ApplicationIdentity: 'Identity' }));
jest.mock('@/components/napplet/NappletRequiredAccess', () => ({ NappletRequiredAccess: () => null }));

let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });
it.each(['light', 'dark'] as const)('uses unframed artwork and a single-line description in %s mode', async scheme => {
  mockScheme = scheme;
  const application: ApplicationListEntry = { title: 'Notes', kind: 'napp', description: 'Write\nyour ideas', servers: [], publisher: 'a'.repeat(64) };
  await act(async () => { renderer = create(<ApplicationListRow application={application} onPress={() => {}} />); });
  expect(renderer.root.findByType(RunningApplicationIcon).props.borderColor).toBeUndefined();
  expect(renderer.root.findByType(ListRow).props.trailing).toBeUndefined();
  expect(renderer.root.findByType(ListRow).props.iconAlign).toBe('start');
  expect(renderer.root.findByType(ListRow).props.verticalPadding).toBe('md');
  expect(renderer.root.findByType(ListRow).props.iconWidth).toBe(spacing['2xl'] + spacing.sm);
  expect(renderer.root.findByType(RunningApplicationIcon).props.size).toBe(spacing['2xl'] + spacing.sm);
  const description = renderer.root.findAllByType(AppText).find(node => node.props.children === 'Write your ideas');
  expect(description?.props.numberOfLines).toBe(1);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'Alice')).toBe(true);
});

it.each(['napp', 'napplet'] as const)('shows the %s format quietly below the information title', async kind => {
  await act(async () => { renderer = create(<ApplicationInfo release={{ title: 'App', kind, description: '', servers: [], required: [] }} onPublisher={() => {}} />); });
  expect(renderer.root.findByType(ApplicationIdentity).props.subtitle).toBe(`applications.formats.${kind}`);
});

it.each(['light', 'dark'] as const)('identifies website results with a muted web label in %s mode', async scheme => {
  mockScheme = scheme;
  const application: ApplicationListEntry = { key: 'https://example.com/', title: 'example.com', kind: 'website', servers: [] };
  await act(async () => { renderer = create(<ApplicationListRow application={application} onPress={() => {}} />); });
  const label = renderer.root.findAllByType(AppText).find(node => node.props.children === 'applications.formats.website');
  expect(label?.props).toMatchObject({ variant: 'caption', tone: 'muted' });
  expect(renderer.root.findAllByProps({ testID: 'discovery-publisher' })).toHaveLength(0);
  await act(async () => { renderer.update(<ApplicationListRow application={{ ...application, kind: 'napp' }} onPress={() => {}} />); });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'applications.formats.website')).toBe(false);
});
