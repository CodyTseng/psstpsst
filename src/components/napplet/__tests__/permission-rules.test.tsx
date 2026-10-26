import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NappletPermissions } from '../NappletPermissions';
import { SigningRuleEditor } from '../SigningRuleEditor';
import { ListRow } from '@/components/common/ListRow';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';
import type { SigningSnapshot } from '@/services/signing/model';
jest.mock('@/services/signing/management',()=>({updatePermissions:jest.fn()}));

let mockFocused = true;
let mockAccount = 'accountA';
const source = { key: 'post', scope: { operation: 'publish' as const, kind: 1, relays: [] },
  decision: 'allow' as const, duration: 'always' as const, createdAt: 100 };
let mockData: SigningSnapshot;
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/stores/napplet.store', () => ({ useNappletAccountPubkey: () => mockAccount }));
jest.mock('@/hooks/use-napplet-permissions', () => ({ useNappletPermissions: () => ({ data: mockData, accountPubkey: mockAccount }) }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { updateSigningRule: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: () => ({ name: 'Recipient' }) }));
jest.mock('../SigningRequestDetails', () => ({ signingAction: () => 'Publish a post' }));
jest.mock('../SigningRuleEditor', () => ({ SigningRuleEditor: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: () => null }));
jest.mock('@/components/common/ListGroup', () => ({ ListGroup: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('lucide-react-native/icons/chevron-up', () => () => null);
jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('@/theme', () => ({ spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, useThemeColors: () => ({ accent: 'accent', textMuted: 'muted' }) }));
const release = { key: 'app', hash: 'v1' } as NappletRelease;
let renderer: ReactTestRenderer;
const screen = () => <NappletPermissions release={release} initiallyExpanded />;
const rows = () => renderer.root.findAllByType(ListRow);
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; mockAccount = 'accountA'; mockData = { rules: [source], activity: [] };
  jest.mocked(nappletService.updateSigningRule).mockImplementation(async (_release, _source, change) => {
    mockData = { ...mockData, rules: change.decision === 'ask' ? [] : [{ ...source, decision: change.decision, duration: change.duration }] };
  });
  act(() => { renderer = create(screen()); });
});
afterEach(() => { act(() => renderer.unmount()); });

it('makes asking effective immediately but retains the row until the next visit', async () => {
  act(() => { rows()[0].props.onPress(); });
  await act(async () => { await renderer.root.findByType(SigningRuleEditor).props.onSave({ decision: 'ask', duration: 'always' }); });
  expect(mockData.rules).toHaveLength(0);
  expect(rows()).toHaveLength(1);
  expect(rows()[0].props.titleTrailing.props.decision).toBe('ask');
  mockFocused = false; act(() => { renderer.update(screen()); });
  mockFocused = true; act(() => { renderer.update(screen()); });
  expect(rows()).toHaveLength(0);
});

it('restores the displayed decision if saving fails', async () => {
  jest.mocked(nappletService.updateSigningRule).mockRejectedValueOnce(new Error('disk-full'));
  act(() => { rows()[0].props.onPress(); });
  await act(async () => {
    await expect(renderer.root.findByType(SigningRuleEditor).props.onSave({ decision: 'ask', duration: 'always' })).rejects.toThrow('disk-full');
  });
  expect(rows()[0].props.titleTrailing.props.decision).toBe('allow');
});

it('never carries retained asking rows into a different account', async () => {
  act(() => { rows()[0].props.onPress(); });
  await act(async () => { await renderer.root.findByType(SigningRuleEditor).props.onSave({ decision: 'ask', duration: 'always' }); });
  mockAccount = 'accountB'; mockData = { rules: [], activity: [] };
  act(() => { renderer.update(screen()); });
  expect(rows()).toHaveLength(0);
});

it('keeps signing history accessible without showing an empty rules section', () => {
  mockData = { rules: [], activity: [{ scope: source.scope, decision: 'allowed', at: 100 }] };
  act(() => { renderer.update(screen()); });
  expect(renderer.root.findAllByType(AppText)).toHaveLength(0);
  expect(rows()).toHaveLength(0);
  const disclosure = renderer.root.findByType(AppButton);
  expect(disclosure.props.label).toBe('napplets.signing_activity');
  expect(disclosure.props.accessibilityState.expanded).toBe(false);
  act(() => { disclosure.props.onPress(); });
  expect(disclosure.props.accessibilityState.expanded).toBe(true);
  expect(rows()).toHaveLength(1);
  expect(rows()[0].props.title).toBe('Publish a post');
  expect(rows()[0].props.subtitle).toContain('napplets.signing_allowed');
  act(() => { disclosure.props.onPress(); });
  expect(rows()).toHaveLength(0);
});

it('hides the section when both rules and signing history are empty', () => {
  mockData = { rules: [], activity: [] };
  act(() => { renderer.update(screen()); });
  expect(renderer.root.findAllByType(AppText)).toHaveLength(0);
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  expect(rows()).toHaveLength(0);
});
