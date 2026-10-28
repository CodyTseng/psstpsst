import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator } from 'react-native';
import { ApplicationDetailsPage } from '../ApplicationDetailsPage';
import { ApplicationOpenSetting } from '../ApplicationOpenSetting';
import { NappletRequiredAccess } from '../NappletRequiredAccess';
import { applicationPresentation, type ExploreEntry } from '@/services/explore/model';
let mockMembershipReady = true;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string; name?: string }) => key === 'napplets.capability_unsupported' ? `${options?.name} (not supported)` : options?.defaultValue ?? key }) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: 'Screen' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('@/components/common/ListGroup', () => ({ ListGroup: 'ListGroup' }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: 'ListRow' }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: 'Header', useScreenHeaderClearance: () => 56 }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('../NappletInfo', () => ({ ApplicationInfo: 'Info' }));
jest.mock('../ApplicationComments', () => ({ ApplicationComments: 'Comments' }));
jest.mock('../ApplicationDetailsMembership', () => ({ ApplicationDetailsMembership: ({ children }: {
  children(action: React.ReactNode, ready: boolean): React.ReactNode;
}) => children(jest.requireActual('react').createElement('Membership', { key: 'membership' }), mockMembershipReady) }));
jest.mock('../ApplicationDetailsActions', () => ({ ApplicationDetailsActions: 'Actions' }));
jest.mock('../ApplicationOpenSetting', () => ({ ApplicationOpenSetting: 'OpeningPreference' }));
jest.mock('@/theme', () => ({ spacing: { lg: 16, xl: 24, sm: 8 }, useThemeColors: () => ({ accent: 'accent' }) }));

const entry: ExploreEntry = { key: 'https://example.com', address: 'https://example.com', title: 'Website',
  kind: 'website', description: '', required: [], servers: [], desktopPosition: null, lastUsedAt: null };
beforeEach(() => { mockMembershipReady = true; });

it.each([false, true])('waits for initial access before showing details and actions with discussion=%s', discussion => {
  const page = (loaded: boolean) => <ApplicationDetailsPage application={applicationPresentation(entry)}
    access={{ loaded, approved: false }} actions={{ entry, account: 'account' }}
    discussion={discussion ? { entry, account: 'account' } : undefined} onOpen={() => {}} onPublisher={() => {}} />;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(page(false)); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(renderer.root.findByType('Header' as never).props.right).toBeUndefined();
  for (const type of ['Info', 'Comments', 'Actions', 'OpeningPreference']) {
    expect(renderer.root.findAllByType(type as never)).toHaveLength(0);
  }
  act(() => { renderer.update(page(true)); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(renderer.root.findAllByType((discussion ? 'Comments' : 'Info') as never)).toHaveLength(1);
  expect(renderer.root.findByType('Header' as never).props.right.type).toBe('Actions');
  const content=renderer.root.findByType((discussion ? 'Comments' : 'Info') as never);
  act(() => { renderer.update(page(false)); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(renderer.root.findByType((discussion ? 'Comments' : 'Info') as never)).toBe(content);
  act(() => renderer.unmount());
});

it('stops loading when the initial access read fails', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationDetailsPage application={applicationPresentation(entry)}
    access={{ loaded: false, approved: false }} error="napplets.request_failed"
    onOpen={() => {}} onPublisher={() => {}} />); });
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(renderer.root.findAllByType('Info' as never)).toHaveLength(1);
  act(() => renderer.unmount());
});

it('passes unsupported capabilities into application information and keeps Open disabled', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationDetailsPage application={applicationPresentation(entry)}
    access={{ loaded: true, approved: true }} unsupported={['ui', 'dev', 'ui']}
    onOpen={() => {}} onPublisher={() => {}} />); });
  const info=renderer.root.findByType('Info' as never);
  expect(info.props.action(false).props.children.find((child: { key?: string } | null) => child?.key === 'open').props.disabled).toBe(true);
  expect(info.props.unsupported).toEqual(['ui', 'dev', 'ui']);
  expect(info.props.notice).toBeUndefined();
  act(() => renderer.unmount());
});

it('marks unsupported requirements in one list with a single explanation', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer=create(<NappletRequiredAccess release={{ required: ['shell', 'network', 'ui', 'dev', 'ui'] }} unsupported={['ui', 'dev']} />); });
  expect(renderer.root.findAllByType('ListRow' as never).map(node=>[node.props.title,node.props.titleTone]))
    .toEqual([['network','default'],['ui (not supported)','danger'],['dev (not supported)','danger']]);
  expect(renderer.root.findAllByType('Text' as never).map(node=>node.props.children))
    .toEqual(['napplets.capabilities_required','napplets.unsupported']);
  act(() => renderer.unmount());
});

it.each([false, true])('places the webpage preference in the details body with discussion=%s', discussion => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationDetailsPage application={applicationPresentation(entry)}
    access={{ loaded: true, approved: true }} actions={{ entry, account: 'account' }}
    discussion={discussion ? { entry, account: 'account' } : undefined} onOpen={() => {}} onPublisher={() => {}} />); });
  const body = discussion ? renderer.root.findByType('Comments' as never).props.header : null;
  if (body) {
    let header!: ReactTestRenderer;
    act(() => { header = create(body); });
    expect(header.root.findByType(ApplicationOpenSetting).props).toEqual({ entry, account: 'account' });
    act(() => header.unmount());
  } else {
    expect(renderer.root.findByType(ApplicationOpenSetting).props).toEqual({ entry, account: 'account' });
  }
  act(() => renderer.unmount());
});

it('puts Open at the edge beside identity and first when actions are below', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<ApplicationDetailsPage application={applicationPresentation(entry)}
    access={{ loaded: true, approved: true }} actions={{ entry, account: 'account' }}
    onOpen={() => {}} onPublisher={() => {}} />); });
  const keys = (inline: boolean) => renderer.root.findByType('Info' as never).props.action(inline).props.children.map((child: { key: string }) => child.key);
  expect(keys(false)).toEqual(['open', 'membership']);
  expect(keys(true)).toEqual(['membership', 'open']);
  expect(keys(false)).toEqual(['open', 'membership']);
  act(() => renderer.unmount());
});

it('reveals the entire body only after membership and header placement are settled', () => {
  mockMembershipReady = false;
  const page = () => <ApplicationDetailsPage application={applicationPresentation(entry)}
    access={{ loaded: true, approved: true }} actions={{ entry, account: 'account' }}
    onOpen={() => {}} onPublisher={() => {}} />;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(page()); });
  expect(renderer.root.findAllByType('Info' as never)).toHaveLength(0);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  mockMembershipReady = true;
  act(() => { renderer.update(page()); });
  const body = () => renderer.root.findByProps({ testID: 'application-details-body' });
  expect(body().props.style.opacity).toBe(0);
  expect(body().props.style.pointerEvents).toBe('none');
  act(() => { renderer.root.findByType('Info' as never).props.onPlacementReady(); });
  expect(body().props.style.opacity).toBe(1);
  expect(body().props.style.pointerEvents).toBe('auto');
  mockMembershipReady = false;
  act(() => { renderer.update(page()); });
  expect(body().props.style.opacity).toBe(1);
  expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  act(() => renderer.unmount());
});
