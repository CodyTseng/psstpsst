import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NappletPermissions } from '../NappletPermissions';
import { SigningRuleEditor } from '../SigningRuleEditor';
import { AppAuthorizationLevelEditor } from '../app-authorization-level-choices';
import { updateAppAuthorizationLevel } from '@/services/signing/management';
import { ListRow } from '@/components/common/ListRow';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';
import type { SigningSnapshot } from '@/services/signing/model';
jest.mock('@/i18n', () => ({ language: 'en', resolvedLanguage: 'en', t: (key: string) => key }));
jest.mock('@/services/signing/management',()=>({updatePermissions:jest.fn(),updateAppAuthorizationLevel:jest.fn(async()=>{})}));
jest.mock('../app-authorization-level-choices', () => ({ AppAuthorizationLevelEditor: () => null }));

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
const release = { eventKey: 'app', hash: 'v1' } as NappletRelease;
let renderer: ReactTestRenderer;
const screen = () => <NappletPermissions accountPubkey={mockAccount} release={release} initiallyExpanded />;
const rows = () => renderer.root.findAllByType(ListRow).filter(row => !['applications.app_authorization_level_title', 'applications.signing_activity'].includes(row.props.title));
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; mockAccount = 'accountA'; mockData = { rules: [source], activity: [] };
  jest.mocked(nappletService.updateSigningRule).mockImplementation(async (_release, _source, change) => {
    mockData = { ...mockData, rules: [{ ...source, decision: change.decision, duration: change.duration }] };
  });
  act(() => { renderer = create(screen()); });
});
afterEach(() => { act(() => renderer.unmount()); });

it('persists asking as an exception across visits', async () => {
  act(() => { rows()[0].props.onPress(); });
  await act(async () => { await renderer.root.findByType(SigningRuleEditor).props.onSave({ decision: 'ask', duration: 'always' }); });
  expect(mockData.rules[0].decision).toBe('ask');
  expect(rows()).toHaveLength(1);
  expect(rows()[0].props.titleTrailing.props.decision).toBe('ask');
  mockFocused = false; act(() => { renderer.update(screen()); });
  mockFocused = true; act(() => { renderer.update(screen()); });
  expect(rows()).toHaveLength(1);
  expect(rows()[0].props.titleTrailing.props.decision).toBe('ask');
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

it('keeps the account-permissions heading when only signing history is present', () => {
  mockData = { rules: [], activity: [{ scope: source.scope, decision: 'allowed', at: 100 }] };
  act(() => { renderer.update(screen()); });
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toContain('applications.permissions_signing');
  expect(rows()).toHaveLength(0);
  const disclosure = renderer.root.findAllByType(ListRow).find(row => row.props.title === 'applications.signing_activity')!;
  expect(disclosure.props.accessibilityState.expanded).toBe(false);
  act(() => { disclosure.props.onPress(); });
  expect(disclosure.props.accessibilityState.expanded).toBe(true);
  expect(rows()).toHaveLength(1);
  expect(rows()[0].props.title).toBe('Publish a post');
  expect(rows()[0].props.subtitle).toContain('applications.signing_allowed');
  act(() => { disclosure.props.onPress(); });
  expect(rows()).toHaveLength(0);
});

it('keeps the level control available without rules or history', () => {
  mockData = { rules: [], activity: [] };
  act(() => { renderer.update(screen()); });
  expect(renderer.root.findAllByType(AppText)).toHaveLength(0);
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  expect(rows()).toHaveLength(0);
  expect(renderer.root.findAllByType(ListRow).some(row => row.props.title === 'applications.app_authorization_level_title')).toBe(true);
});

it('edits the source level without modifying its explicit exceptions', async () => {
  const levelRow = renderer.root.findAllByType(ListRow).find(row => row.props.title === 'applications.app_authorization_level_title')!;
  act(() => { levelRow.props.onPress(); });
  await act(async () => { await renderer.root.findByType(AppAuthorizationLevelEditor).props.onSave('trusted'); });
  expect(updateAppAuthorizationLevel).toHaveBeenCalledWith({ accountPubkey: 'accountA', sourceId: 'https://app' }, 'trusted');
  expect(nappletService.updateSigningRule).not.toHaveBeenCalled();
  expect(mockData.rules).toEqual([source]);
});

it('creates individual rules only for recent operations outside the level', async () => {
  mockData = { rules: [], level: 'routine', activity: [{ scope: { ...source.scope, kind: 5 }, decision: 'allowed', at: 100 }] };
  act(() => { renderer.update(screen()); });
  act(() => { renderer.root.findAllByType(ListRow).find(row => row.props.title === 'applications.signing_activity')!.props.onPress(); });
  act(() => { rows()[0].props.onPress(); });
  const editor = renderer.root.findByType(SigningRuleEditor);
  expect(editor.props.isNew).toBe(true);
  expect(editor.props.rule.decision).toBe('ask');
  await act(async () => { await editor.props.onSave({ decision: 'ask', duration: 'always' }); });
  expect(mockData.rules[0].decision).toBe('ask');
});

it('hides level-covered saved rules and restores them after a downgrade', () => {
  mockData = { rules: [{ ...source, decision: 'deny' }], level: 'routine', activity: [] };
  act(() => { renderer.update(screen()); });
  expect(rows()).toHaveLength(0);
  expect(mockData.rules[0].decision).toBe('deny');
  mockData = { ...mockData, level: 'manual' };
  act(() => { renderer.update(screen()); });
  expect(rows()[0].props.onPress).toBeDefined();
  expect(rows()[0].props.titleTrailing.props.decision).toBe('deny');
});

it('does not expose a single-operation editor from level-covered history', () => {
  mockData = { rules: [], level: 'routine', activity: [{ scope: source.scope, decision: 'automatic', at: 100 }] };
  act(() => { renderer.update(screen()); });
  act(() => { renderer.root.findAllByType(ListRow).find(row => row.props.title === 'applications.signing_activity')!.props.onPress(); });
  expect(rows()[0].props.onPress).toBeUndefined();
  expect(rows()[0].props.trailing).toBeUndefined();
});

it('closes a single-operation editor if a level change covers its operation', async () => {
  act(() => { rows()[0].props.onPress(); });
  mockData = { ...mockData, level: 'routine' };
  act(() => { renderer.update(screen()); });
  const editor = renderer.root.findByType(SigningRuleEditor);
  expect(editor.props.visible).toBe(false);
  await act(async () => {
    await expect(editor.props.onSave({ decision: 'deny', duration: 'always' })).rejects.toThrow('permission-revoked');
  });
  expect(nappletService.updateSigningRule).not.toHaveBeenCalled();
});
