import { router } from 'expo-router';
import { discoverApplications, loadMoreApplications } from '@/services/explore/discovery';
import type { ExploreEntry } from '@/services/explore/model';
import { BottomSheet } from '@/components/common/BottomSheet';
import { WalletApproval } from '../WalletApproval';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SigningApproval, SigningActions } from '../SigningApproval';
import { NappletOverlays } from '../NappletOverlays';
import { UploadApproval } from '../UploadApproval';
import { CapabilityActions, CapabilityApproval } from '../CapabilityApproval';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { SigningIdentity, SigningAccountAvatar, SigningRequestDetails } from '../SigningRequestDetails';
import type { NappletRelease } from '@/services/napplet/protocol';
import { ActionMenuPanel } from '@/components/common/ActionMenuPanel';
import { ActionRow } from '@/components/common/ActionRow';
import { nappletService } from '@/services/napplet/service';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { platform } from '@/platform';
import { getEventHash, serializeEvent } from 'nostr-tools';
import { darkPalette, lightPalette, spacing } from '@/theme';

let mockDiscovery = { entries: [] as ExploreEntry[], loaded: true, loading: false, loadingMore: false, error: false, hasMore: false, queryPages: 0 };
jest.mock('@/stores/explore-discovery.store', () => ({ useDiscovery: () => mockDiscovery }));
jest.mock('@/services/explore/discovery', () => ({ discoverApplications: jest.fn(async () => {}), loadMoreApplications: jest.fn(async () => {}) }));

jest.mock('@solar-icons/react-native/category/map/Linear/Compass', () => ({ Compass: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/external-link', () => () => null);
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('lucide-react-native/icons/chevron-up', () => () => null);
jest.mock('lucide-react-native/icons/check', () => () => null);
jest.mock('lucide-react-native/icons/copy', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('@/components/common/ContextMenu', () => {
  const Menu = ({ items, onClose }: { items: object[]; onClose: () => void }) => {
    const { ActionMenuPanel } = jest.requireMock('@/components/common/ActionMenuPanel');
    return <ActionMenuPanel items={items} onSelect={(item: { onPress: () => void }) => { onClose(); item.onPress(); }} />;
  };
  return { ContextMenuOverlay: Menu, ContextMenu: Menu };
});

let mockActiveAccount: string | null = 'a'.repeat(64);
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: { getState: () => ({ activePubkey: mockActiveAccount }) } }));
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/common/ActionMenuPanel', () => ({ ActionMenuPanel: () => null }));
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: () => ({ name: 'Alice', profile: null }) }));
jest.mock('@/services/napplet/service', () => ({ nappletStore: { getState: () => ({ prompt: mockPrompt }) }, nappletService: { answer: jest.fn(), rejectAllRequests: jest.fn(), closeConfiguration: jest.fn(), overlayClosed: jest.fn() } }));
jest.mock('@/platform', () => ({ platform: { napplet: {}, deviceCrypto: { sha256Hex: jest.fn() }, clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } } }));
jest.mock('@/services/napplet/repository', () => ({ getData: jest.fn(), setData: jest.fn() }));

jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('../ApplicationChoiceRow', () => ({ ApplicationChoiceRow: () => null }));
jest.mock('../ApplicationTaskContext', () => ({ useOwnsApplicationTaskOverlays: () => true }));
jest.mock('../NappletPanel', () => ({ NappletPanel: () => null, NappletPanelActions: () => null }));
jest.mock('../ApplicationIcon', () => ({ ApplicationIcon: () => null }));
jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: ({ children, headerAction, fixedSubheader, fixedFooter, modalOverlay, listProps }: { listProps?: { data: unknown[]; ListEmptyComponent?: React.ReactNode }; children: React.ReactNode; headerAction: React.ReactNode; fixedSubheader: React.ReactNode; fixedFooter: React.ReactNode; modalOverlay: React.ReactNode }) => {
    const View = jest.requireActual('react-native').View;
    return <View>{headerAction}{fixedSubheader}{listProps?.data.length === 0 ? listProps.ListEmptyComponent : null}{children}{fixedFooter}{modalOverlay}</View>;
  },
}));
let mockPrompt: QueuedPrompt | null = null;
let mockApprovalClosing = false;
jest.mock('../WalletApproval', () => ({ WalletApproval: () => null }));
jest.mock('@/stores/napplet.store', () => ({ getNappletAccountPubkey: () => null, useNapplets: () => ({ prompt: mockPrompt, approvalClosing: mockApprovalClosing, configuration: null }) }));

let renderer: ReactTestRenderer;
const prompt = {
  requestId: 'request-A', expiresAt: Date.now() + 60000, queued: 0, title: 'Game', detail: '',
  signing: { operation: 'publish', kind: 1, accountPubkey: 'a'.repeat(64), content: 'Hello from the app', tags: [], createdAt: 100, relays: ['wss://relay.example/'] },
} satisfies QueuedPrompt;
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); mockApprovalClosing = false; mockActiveAccount = 'a'.repeat(64); mockDiscovery = { entries: [], loaded: true, loading: false, loadingMore: false, error: false, hasMore: false, queryPages: 0 }; });
function selectDuration(value: string) {
  act(() => { renderer.root.findByType(SigningActions).props.onMenuChange({ x: 180, y: 700 }); });
  const menu = renderer.root.findByType(ActionMenuPanel);
  expect(menu.props.items).toHaveLength(5);
  act(() => { menu.props.onSelect(menu.props.items.find((item: { key: string }) => item.key === value)); });
  expect(renderer.root.findAllByType(ActionMenuPanel)).toHaveLength(0);
}
const button = (label: string) => renderer.root.findAllByType(AppButton).find((node) => node.props.label === label)!;

it.each(['light', 'dark'] as const)('reviews files as app consent without signing controls in %s mode', (scheme) => {
  mockScheme = scheme;
  const file = { ...prompt, signing: undefined,
    upload: { filename: 'card.png', mimeType: 'image/png', size: 1024, sha256: 'c'.repeat(64), servers: ['https://storage.example/'] } };
  act(() => { renderer = create(<UploadApproval prompt={file} />); });
  const text = renderer.root.findAllByType(AppText).map((node) => node.props.children);
  expect(text).toContain('applications.signing_effect_upload');
  expect(text).toContain('card.png'); expect(text).toContain('https://storage.example/');
  expect(text).not.toContain('image/png');
  expect(text).not.toContain('message_detail.file_type');
  expect(text.indexOf('card.png')).toBeLessThan(text.indexOf('https://storage.example/'));
  expect(text.indexOf('https://storage.example/')).toBeLessThan(text.indexOf('applications.signing_effect_upload'));
  for (const value of ['card.png', '1.0 KB', 'https://storage.example/']) {
    const node = renderer.root.findAllByType(AppText).find(row => row.props.children === value)!;
    expect(node.props.variant).toBe('body');
    expect(node.props.weight).toBe('regular');
  }
  expect(renderer.root.findAllByType(SigningActions)).toHaveLength(0);
  for (const content of ['card.png', 'https://storage.example/', 'applications.signing_effect_upload'])
    expect(renderer.root.findAllByType(AppText).find((node) => node.props.children === content)!.props.selectable).toBe(false);
  act(() => { void button('applications.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'allow');
});

it.each(['light', 'dark'] as const)('binds scope selection and approval to the displayed request in %s mode', (scheme) => {
  mockScheme = scheme;
  act(() => { renderer = create(<SigningApproval prompt={prompt} />); });
  const content = renderer.root.findAllByType(AppText).find((node) => node.props.children === prompt.signing!.content)!;
  expect(StyleSheet.flatten(content.findByType(Text).props.style).color).toBe((scheme === 'dark' ? darkPalette : lightPalette).text);
  selectDuration('allow-always');
  act(() => { void button('applications.signing_approve').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'allow-always');
  act(() => { renderer.update(<SigningApproval key="request-B" prompt={{ ...prompt, requestId: 'request-B' }} />); });
  act(() => { void button('applications.signing_approve').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-B', 'allow');
});

it('uses exactly two side-by-side decisions and applies the selected time to refusal', () => {
  act(() => { renderer = create(<SigningApproval prompt={prompt} />); });
  selectDuration('allow-1h');
  expect(renderer.root.findByType(ActionRow).props.layout).toBe('horizontal');
  expect(renderer.root.findAllByType(AppButton).filter((node) => node.props.label === 'applications.signing_block')).toHaveLength(0);
  act(() => { void button('applications.signing_reject_countdown').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'deny-1h');
});

it('omits optional capabilities from launch consent and grants only required access', () => {
  const capability = { ...prompt, signing: undefined, capabilities: { required: ['shell'], optional: ['identity'] } };
  act(() => { renderer = create(<CapabilityApproval prompt={capability} />); });
  expect(renderer.root.findAllByType(AppButton).some((node) => node.props.label === 'applications.capability_identity')).toBe(false);
  act(() => { void button('applications.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'domains:[]');
});

it.each(['light', 'dark'] as const)('reviews the requested optional capability with explicit Allow/Reject in %s mode', scheme => {
  mockScheme = scheme;
  const capability = { ...prompt, signing: undefined,
    capabilities: { required: ['config'], optional: [], requested: 'config' } };
  act(() => { renderer = create(<CapabilityApproval prompt={capability} />); });
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toContain('applications.capability_config');
  act(() => { void button('applications.signing_reject').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'deny');
  act(() => { void button('applications.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'allow');
});

it('keeps the fixed footer bound to its request and resets duration before a new request is displayed', () => {
  mockPrompt = prompt;
  act(() => { renderer = create(<NappletOverlays />); });
  selectDuration('allow-always');
  const previousApprove = button('applications.signing_approve').props.onPress;
  mockPrompt = { ...prompt, requestId: 'new-request' };
  act(() => { renderer.update(<NappletOverlays />); });
  act(() => { void button('applications.signing_approve').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('new-request', 'allow');
  act(() => { void previousApprove(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'allow-always');
  expect(renderer.root.findByType(SigningApproval).props.hideActions).toBe(true);
  mockPrompt = null;
});

it('prioritizes the requesting app and account and expands directly into JSON and destinations', () => {
  mockPrompt = { ...prompt, accountPubkey: 'a'.repeat(64), app: {
    title: 'App', hash: 'c'.repeat(64), event: { pubkey: 'b'.repeat(64) },
  } as NappletRelease };
  act(() => { renderer = create(<NappletOverlays />); });
  expect(renderer.root.findByType(SigningAccountAvatar).props.pubkey).toBe('a'.repeat(64));
  expect(renderer.root.findAllByType(SigningIdentity)).toHaveLength(0);
  act(() => { void button('applications.signing_details').props.onPress(); });
  expect(renderer.root.findAllByType(SigningIdentity)).toHaveLength(0);
  const text = renderer.root.findAllByType(AppText).map((node) => node.props.children);
  expect(text).toContain(JSON.stringify({ pubkey: prompt.signing!.accountPubkey, kind: 1, created_at: 100,
    content: prompt.signing!.content, tags: [] }, null, 2));
  expect(text).toContain('wss://relay.example/');
  mockPrompt = null;
});

it('shows a readable application-data preview while keeping the complete payload accessible', () => {
  const request = { ...prompt.signing!, kind: 30078, scopeKey: 'progress', content: JSON.stringify({ score: 120, level: 3, state: { opaque: true } }) };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const text = () => renderer.root.findAllByType(AppText).map((node) => node.props.children);
  expect(text()).toContain('score'); expect(text()).toContain('120');
  expect(text()).not.toContain(request.content);
  expect(text()).not.toContain('wss://relay.example/');
  act(() => { void button('applications.signing_details').props.onPress(); });
  expect(text().some((value) => typeof value === 'string' && value.includes('"kind": 30078'))).toBe(true);
});

it.each([true, false])('checks the embedded repost content address before showing a readable excerpt (valid: %s)', async (valid) => {
  const original = { kind: 1, content: 'Original post preview', pubkey: 'a'.repeat(64), created_at: 100, tags: [] };
  const hash = getEventHash(original);
  const reference = valid ? hash : (hash[0] === 'a' ? 'b' : 'a') + hash.slice(1);
  jest.mocked(platform.deviceCrypto.sha256Hex).mockResolvedValueOnce(hash);
  const request = { ...prompt.signing!, kind: 6, tags: [['e', reference]], content: JSON.stringify({ ...original, id: reference }) };
  await act(async () => { renderer = create(<SigningRequestDetails request={request} />); });
  expect(platform.deviceCrypto.sha256Hex).toHaveBeenCalledWith(new TextEncoder().encode(serializeEvent(original)));
  const content = renderer.root.findAllByType(AppText).map((node) => node.props.children);
  if (valid) expect(content).toContain(original.content);
  else {
    expect(content).not.toContain(original.content);
    expect(content).toContain(request.content);
  }
});

it.each(['light', 'dark'] as const)('blocks backdrop dismissal and closes the duration menu before dismissing the signing sheet in %s mode', (scheme) => {
  mockScheme = scheme;
  mockPrompt = prompt;
  act(() => { renderer = create(<NappletOverlays />); });
  act(() => { renderer.root.findByType(SigningActions).props.onMenuChange({ x: 180, y: 700 }); });
  const sheet = renderer.root.findByType(jest.requireMock('@/components/common/BottomSheet').BottomSheet);
  expect(sheet.props.dismissOnBackdropPress).toBe(false);
  act(() => { sheet.props.onClose(); });
  expect(renderer.root.findAllByType(ActionMenuPanel)).toHaveLength(0);
  expect(nappletService.rejectAllRequests).not.toHaveBeenCalled();
  act(() => { sheet.props.onClose(); });
  expect(nappletService.rejectAllRequests).not.toHaveBeenCalled();
  expect(nappletService.answer).toHaveBeenLastCalledWith(prompt.requestId, false);
  mockPrompt = null;
});

it('disables JSON text selection and copies the complete displayed event', async () => {
  act(() => { renderer = create(<SigningRequestDetails request={prompt.signing!} />); });
  act(() => { button('applications.signing_details').props.onPress(); });
  const json = renderer.root.findAllByType(AppText).find((node) => node.props.variant === 'code')!;
  expect(json.props.selectable).toBe(false);
  expect(StyleSheet.flatten(json.props.style).userSelect).toBe('none');
  await act(async () => { button('common.copy').props.onPress(); });
  expect(platform.clipboard.writeText).toHaveBeenCalledWith(json.props.children);
  expect(JSON.parse(json.props.children)).toEqual({
    pubkey: prompt.signing!.accountPubkey, kind: 1, created_at: 100, content: prompt.signing!.content, tags: [],
  });
  expect(button('common.copied')).toBeDefined();
});

it('disables selection across raw JSON previews, relay addresses and signing identities', () => {
  const request = { ...prompt.signing!, kind: 30079, recipient: 'b'.repeat(64), content: '{"score":120}' };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  act(() => { button('applications.signing_details').props.onPress(); });
  const texts = renderer.root.findAllByType(AppText);
  expect(texts.some((node) => node.props.children === request.content)).toBe(true);
  expect(texts.some((node) => node.props.children === 'wss://relay.example/')).toBe(true);
  for (const text of texts.filter((node) => node.props.children !== 'applications.signing_hide_details' && node.props.children !== 'common.copy')) {
    expect(text.props.selectable).toBe(false);
    expect(StyleSheet.flatten(text.props.style).userSelect).toBe('none');
  }
});

it.each([
  [1, [['d', 'actual-record']], null],
  [3, [['d', 'actual-record']], null],
  [10001, [['d', 'actual-record']], null],
  [30078, [['d', 'actual-record']], 'actual-record'],
  [30078, [['d', '']], 'applications.signing_unnamed'],
  [30078, [], 'applications.none'],
] as const)('shows kind %s and its applicable d tag before expanding details', (kind, tags, expected) => {
  const request = { ...prompt.signing!, kind, tags: tags.map((tag) => [...tag]), scopeKey: 'untrusted-derived-record' };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const texts = renderer.root.findAllByType(AppText).map((node) => node.props.children);
  expect(texts).toContain('applications.signing_kind');
  expect(texts.some(value => typeof value === 'string' && (value === String(kind) || value.endsWith(` · ${kind}`)))).toBe(true);
  if (expected === null) expect(texts).not.toContain('d');
  else {
    expect(texts).toContain('d');
    expect(texts).toContain(expected);
  }
  expect(texts.some((value) => typeof value === 'string' && value.includes('untrusted-derived-record'))).toBe(false);
  expect(renderer.root.findAllByType(AppText).some((node) => node.props.variant === 'code')).toBe(false);
});

it.each([{ tags: [] }, { tags: [['e', 'referenced-event']] }, { tags: [['p', 'a'.repeat(64)]] }])('omits the empty content field and label with tags $tags', ({ tags }) => {
  const request = { ...prompt.signing!, kind: 3, content: '', tags };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).not.toContain('applications.signing_content');
  expect(texts).not.toContain('applications.none');
  expect(texts).not.toContain('d');
});

it('keeps launch permissions focused on required capabilities with a fixed decision footer', () => {
  mockPrompt = { ...prompt, signing: undefined, queued: 12, accountPubkey: 'a'.repeat(64),
    application: { title: 'Armada', description: 'Marketing copy must stay out of this decision', required: ['network', 'storage'], servers: [], publisher: 'b'.repeat(64) } };
  act(() => { renderer = create(<NappletOverlays />); });
  const sheet = renderer.root.findByType(jest.requireMock('@/components/common/BottomSheet').BottomSheet);
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).not.toContain('applications.signing_queued');
  expect(texts).not.toContain('applications.capabilities_signing_notice');
  expect(button('applications.signing_reject_all')).toBeUndefined();
  expect(texts).not.toContain(mockPrompt.application!.description);
  expect(texts).toContain('applications.capability_resource');
  expect(texts).toContain('applications.capability_storage');
  expect(renderer.root.findByType(CapabilityApproval).props.hideActions).toBe(true);
  expect(sheet.props.dismissOnBackdropPress).toBe(false);
  expect(sheet.props.fixedFooter).toBeDefined();
  expect(renderer.root.findByType(SigningAccountAvatar).props.pubkey).toBe('a'.repeat(64));
  act(() => { button('applications.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith(prompt.requestId, 'allow');
  mockPrompt = null;
});

it('shows the concrete browser permission without unrelated application requirements', () => {
  const browser = { ...prompt, signing: undefined, browser: { action: 'permission' as const, resources: ['mediaKeySystem', 'unrecognized-feature'] },
    application: { title: 'Armada', description: '', required: ['network'], servers: [] } };
  act(() => { renderer = create(<CapabilityApproval prompt={browser} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain('applications.browser_protected_media');
  expect(texts).toContain('applications.browser_permission: unrecognized-feature');
  expect(texts).not.toContain('applications.capability_resource');
});

it.each(['u', 'url'])('shows HTTP service and method instead of ordinary event metadata from %s before opening event JSON', tag => {
  const request = { ...prompt.signing!, operation: 'http-auth' as const, kind: 27235, content: '',
    tags: [[tag, 'https://service.example/upload'], ['method', 'POST']] };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain('applications.signing_http_auth');
  expect(texts).toContain('https://service.example');
  expect(texts).not.toContain('applications.signing_kind');
  expect(texts).toContain('https://service.example/upload');
  expect(texts).toContain('applications.signing_url');
  expect(texts).toContain('POST');
  expect(texts).not.toContain('applications.none');
});

it.each(['light', 'dark'] as const)('keeps the full HTTP authentication URL visible beyond reference limits in %s mode', scheme => {
  mockScheme = scheme;
  const url = `https://service.example/upload?token=${'a'.repeat(300)}`;
  const request = { ...prompt.signing!, operation: 'http-auth' as const, kind: 27235, content: '',
    tags: [...Array.from({ length: 5 }, (_, index) => ['e', String(index)]), ['u', url], ['method', 'PUT']] };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const target = renderer.root.findAllByType(AppText).find(node => node.props.children === url)!;
  expect(target).toBeDefined();
  expect(target.props.numberOfLines).toBeUndefined();
  expect(target.props.selectable).toBe(false);
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toContain('PUT');
});

it('identifies a profile event and previews the actual profile values', () => {
  act(() => { renderer = create(<SigningRequestDetails request={{ ...prompt.signing!, operation: 'sign', kind: 0, content: '{"name":"Cody","about":"Hello"}' }} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts.some(value => typeof value === 'string' && value.includes('applications.event_profile'))).toBe(true);
  expect(texts).toContain('Cody'); expect(texts).toContain('Hello');
});

it.each(['get-public-key', 'nip44-encrypt', 'nip04-decrypt'] as const)('reviews %s without peer or event metadata', operation => {
  const request = { operation, relays: [], accountPubkey: 'a'.repeat(64), content: '', tags: [], createdAt: 1 };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).not.toContain('chat.event_reference.kind');
  expect(button('applications.signing_details')).toBeUndefined();
  if (operation === 'get-public-key') {
    expect(texts).toContain('profile.public_key'); expect(texts).toContain('a'.repeat(64));
  } else {
    expect(texts).toContain(operation.startsWith('nip04') ? 'NIP-04' : 'NIP-44');
    expect(renderer.root.findAllByType(SigningIdentity)).toHaveLength(0);
  }
});

it('browser sensitive permissions reuse duration controls for both allow and reject', () => {
  const browser = { ...prompt, signing: undefined, browser: { action: 'permission' as const, resources: ['clipboard-read'] } };
  act(() => { renderer = create(<CapabilityActions prompt={browser} duration="allow-1h" />); });
  expect(button('applications.signing_period_1h')).toBeDefined();
  act(() => { button('applications.signing_approve').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith(prompt.requestId, 'allow-1h');
  act(() => { button('applications.signing_reject_countdown').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith(prompt.requestId, 'deny-1h');
});

it.each(['nip04-encrypt', 'nip44-encrypt'] as const)('shows the original plaintext in %s approval', operation => {
  const text = '  Exact original\n{"literal":"<message>"}  ';
  act(() => { renderer = create(<SigningRequestDetails request={{ ...prompt.signing!, operation, kind: undefined, recipient: undefined, content: text }} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain('applications.crypto_plaintext'); expect(texts).toContain(text);
});
it('bounds long plaintext until expanded and copies the complete original', async () => {
  const text = 'Private original\n'.repeat(100);
  const request = { ...prompt.signing!, operation: 'nip44-encrypt' as const, kind: undefined, recipient: undefined, content: text };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  let texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain(text.slice(0, 600)); expect(texts).not.toContain(text);
  await act(async () => { button('common.copy').props.onPress(); });
  expect(platform.clipboard.writeText).toHaveBeenCalledWith(text);
  act(() => { button('applications.signing_details').props.onPress(); });
  texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain(text);
  act(() => { renderer.update(<SigningRequestDetails request={{ ...request, content: 'another input'.repeat(100) }} />); });
  texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).not.toContain('another input'.repeat(100));
});


it('retains a dedicated wallet sheet until its dismissal completes', () => {
  mockPrompt = { ...prompt, signing: undefined, accountPubkey: 'account', wallet: { operation: 'payment', wallets: [], amountMsat: 1000, description: '' } };
  act(() => { renderer = create(<NappletOverlays />); });
  expect(renderer.root.findByType(WalletApproval).props.visible).toBe(true);
  mockPrompt = null; mockApprovalClosing = true;
  act(() => { renderer.update(<NappletOverlays />); });
  const sheet = renderer.root.findByType(WalletApproval);
  expect(sheet.props.visible).toBe(false);
  expect(sheet.props.prompt.requestId).toBe(prompt.requestId);
  act(() => { sheet.props.onClosed(); });
  expect(nappletService.overlayClosed).toHaveBeenCalled();
  mockApprovalClosing = false;
  act(() => { renderer.update(<NappletOverlays />); });
  expect(renderer.root.findAllByType(WalletApproval)).toHaveLength(0);
});

it.each(['light', 'dark'] as const)('loads compatible apps inline in %s mode', scheme => {
  mockScheme = scheme;
  mockPrompt = { requestId: 'empty', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    accountPubkey: 'a'.repeat(64), choices: [], applicationSelection: { requester: 'Timeline', content: 'content', discovery: { name: 'edit', auxiliary: false } } };
  act(() => { renderer = create(<NappletOverlays />); });
  const sheet = renderer.root.findByType(BottomSheet);
  expect(sheet.props.fixedFooter).toBeUndefined();
  expect(discoverApplications).toHaveBeenCalledWith('a'.repeat(64), false, 'napps');
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toEqual(['applications.no_compatible_apps']);
  expect(router.navigate).not.toHaveBeenCalled();
});

it('prioritizes saved apps, deduplicates discovered apps and filters action and mode', async () => {
  const app = (key: string, action = 'edit', auxiliary = false) => ({ key, address: key, title: key, kind: 'napp', servers: [], description: '', required: [], desktopPosition: null, lastUsedAt: null,
    manifest: { id: key, kind: 35130, pubkey: 'a'.repeat(64), created_at: 1, content: '', sig: '',
      tags: [['action', action], ...(auxiliary ? [['mode', 'auxiliary']] : [])] } }) satisfies ExploreEntry;
  mockDiscovery.entries = [app('saved'), app('other'), app('wrong-action', 'profile'), app('wrong-mode', 'edit', true)];
  mockPrompt = { requestId: 'choices', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    accountPubkey: 'a'.repeat(64), choices: [{ key: 'source:saved', title: 'Saved', application: { key: 'saved', title: 'Saved', kind: 'napp', servers: [] } }],
    applicationSelection: { requester: 'Timeline', content: 'content', discovery: { name: 'edit', auxiliary: false } } };
  act(() => { renderer = create(<NappletOverlays />); });
  const sheet = () => renderer.root.findByType(BottomSheet);
  expect(sheet().props.listProps.data.map((item: { key: string }) => item.key)).toEqual(['source:saved']);
  expect(discoverApplications).not.toHaveBeenCalled();
  expect(sheet().props.listProps.ListFooterComponent.props.children.props.label).toBe('applications.view_other_apps');
  mockDiscovery = { ...mockDiscovery, loading: true, loadingMore: true, error: true };
  act(() => { renderer.update(<NappletOverlays />); });
  expect(sheet().props.listProps.data.map((item: { key: string }) => item.key)).toEqual(['source:saved']);
  expect(sheet().props.listProps.ListFooterComponent.props.children.props.label).toBe('applications.view_other_apps');
  expect(discoverApplications).not.toHaveBeenCalled();
  mockDiscovery = { ...mockDiscovery, loading: false, loadingMore: false, error: false };
  await act(async () => { sheet().props.listProps.ListFooterComponent.props.children.props.onPress(); });
  expect(discoverApplications).toHaveBeenCalledWith('a'.repeat(64), false, 'napps');
  expect(sheet().props.listProps.data.map((item: { key: string }) => item.key)).toEqual(['source:saved', 'discovery:other']);
  jest.mocked(discoverApplications).mockClear();
  mockPrompt = { ...mockPrompt!, requestId: 'next-choice' };
  act(() => { renderer.update(<NappletOverlays />); });
  expect(sheet().props.listProps.data.map((item: { key: string }) => item.key)).toEqual(['source:saved']);
  expect(sheet().props.listProps.ListFooterComponent.props.children.props.label).toBe('applications.view_other_apps');
  expect(discoverApplications).not.toHaveBeenCalled();
});

it('keeps loading, retry and pagination inside the picker without showing premature empty state', async () => {
  mockPrompt = { requestId: 'choices', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    accountPubkey: 'a'.repeat(64), choices: [], applicationSelection: { requester: 'Timeline', content: 'content', discovery: { name: 'edit', auxiliary: false } } };
  mockDiscovery.loading = true;
  mockDiscovery.loaded = false;
  act(() => { renderer = create(<NappletOverlays />); });
  expect(renderer.root.findByType(BottomSheet).props.listProps.ListEmptyComponent).toBeNull();
  mockDiscovery = { ...mockDiscovery, loading: false, error: true };
  act(() => { renderer.update(<NappletOverlays />); });
  await act(async () => { renderer.root.findByType(BottomSheet).props.listProps.ListFooterComponent.props.children.props.onPress(); });
  expect(discoverApplications).toHaveBeenLastCalledWith('a'.repeat(64), true, 'napps');
  mockDiscovery = { ...mockDiscovery, loaded: true, error: false, hasMore: true };
  act(() => { renderer.update(<NappletOverlays />); });
  expect(loadMoreApplications).toHaveBeenCalledWith('a'.repeat(64), 'napps');
});

it.each([
  ['light', 'discover'], ['dark', 'discover'],
] as const)('preserves the %s %s footer button and label while its request is pending', async (scheme, action) => {
  mockScheme = scheme;
  mockDiscovery.hasMore = true;
  mockPrompt = { requestId: 'stable-footer', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    accountPubkey: 'a'.repeat(64), choices: [{ key: 'source:saved', title: 'Saved' }],
    applicationSelection: { requester: 'Timeline', content: 'content', discovery: { name: 'edit', auxiliary: false } } };
  act(() => { renderer = create(<NappletOverlays />); });
  const footer = () => renderer.root.findByType(BottomSheet).props.listProps.ListFooterComponent;
  let finish!: () => void;
  const request = new Promise<void>(resolve => { finish = resolve; });
  jest.mocked(discoverApplications).mockReturnValueOnce(request);
  const before = footer();
  const label = before.props.children.props.label;
  act(() => { before.props.children.props.onPress(); });
  const during = footer();
  expect(during.type).toBe(before.type);
  expect(during.props.style).toEqual(before.props.style);
  expect(during.props.children.type).toBe(AppButton);
  expect(during.props.children.props).toMatchObject({ label, loading: true });
  expect(renderer.root.findByType(BottomSheet).props.listProps.data.map((item: { key: string }) => item.key)).toEqual(['source:saved']);
  mockDiscovery = { ...mockDiscovery, hasMore: false, queryPages: 0 };
  await act(async () => { finish(); });
  expect(footer().props.children.props.children).toBe('applications.no_more_apps');
});

const choiceApp = (index: number, action = 'edit'): ExploreEntry => ({ key: `app-${index}`, address: `app-${index}`, title: `App ${index}`,
  kind: 'napp', servers: [], description: '', required: [], desktopPosition: null, lastUsedAt: null,
  manifest: { id: String(index), kind: 35130, pubkey: 'a'.repeat(64), created_at: index, content: '', sig: '', tags: [['action', action]] } });
function automaticChoicePrompt(): QueuedPrompt {
  return { requestId: 'automatic-choices', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    accountPubkey: 'a'.repeat(64), choices: [], applicationSelection: { requester: 'Timeline', content: 'content', discovery: { name: 'edit', auxiliary: false } } };
}

it('reveals cached compatible apps in windows on scroll, without redundant requests or a More button', () => {
  mockDiscovery.entries = Array.from({ length: 45 }, (_, i) => choiceApp(i));
  mockPrompt = automaticChoicePrompt();
  act(() => { renderer = create(<NappletOverlays />); });
  const list = () => renderer.root.findByType(BottomSheet).props.listProps;
  expect(list().data).toHaveLength(20);
  expect(list().ListFooterComponent.props.children).toBeNull();
  act(() => { list().onEndReached(); });
  expect(list().data).toHaveLength(40);
  act(() => { list().onEndReached(); });
  expect(list().data).toHaveLength(45);
  act(() => { list().onEndReached(); });
  expect(list().data).toHaveLength(45);
  expect(loadMoreApplications).not.toHaveBeenCalled();
  expect(list().ListFooterComponent.props.children.props).toMatchObject({ children: 'applications.no_more_apps', variant: 'caption', tone: 'muted', align: 'center' });
});

it('automatically advances incompatible pages until the requested matching window fills', () => {
  const first = Array.from({ length: 20 }, (_, i) => choiceApp(i));
  mockDiscovery = { ...mockDiscovery, entries: first, hasMore: true };
  mockPrompt = automaticChoicePrompt();
  act(() => { renderer = create(<NappletOverlays />); });
  const list = () => renderer.root.findByType(BottomSheet).props.listProps;
  expect(loadMoreApplications).not.toHaveBeenCalled();
  const restingFooterStyle = list().ListFooterComponent.props.style;
  expect(restingFooterStyle).toMatchObject({ paddingTop: spacing.sm, paddingBottom: spacing.lg, minHeight: spacing.xl + spacing.sm + spacing.lg });
  expect(list().contentContainerStyle.paddingBottom).toBe(0);
  act(() => { list().onEndReached(); });
  expect(loadMoreApplications).toHaveBeenCalledTimes(1);
  expect(list().ListFooterComponent.props.children.type).toBe(ActivityIndicator);
  expect(list().ListFooterComponent.props.style).toEqual(restingFooterStyle);
  act(() => { list().onEndReached(); });
  expect(loadMoreApplications).toHaveBeenCalledTimes(1);
  mockDiscovery = { ...mockDiscovery, entries: [...first, choiceApp(20, 'profile')] };
  act(() => { renderer.update(<NappletOverlays />); });
  expect(list().data).toHaveLength(20);
  expect(loadMoreApplications).toHaveBeenCalledTimes(2);
  mockDiscovery = { ...mockDiscovery, entries: [...mockDiscovery.entries, ...Array.from({ length: 20 }, (_, i) => choiceApp(i + 21))], hasMore: false, queryPages: 0 };
  act(() => { renderer.update(<NappletOverlays />); });
  expect(list().data).toHaveLength(40);
  expect(list().ListFooterComponent.props.children.props).toMatchObject({ children: 'applications.no_more_apps', variant: 'caption', tone: 'muted', align: 'center' });
  expect(list().ListFooterComponent.props.style).toEqual(restingFooterStyle);
  act(() => { list().onEndReached(); });
  expect(loadMoreApplications).toHaveBeenCalledTimes(2);
});

it('stops only this chooser after three empty remote pages, excluding buffered pagination', () => {
  mockDiscovery.hasMore = true;
  mockPrompt = automaticChoicePrompt();
  act(() => { renderer = create(<NappletOverlays />); });
  const list = () => renderer.root.findByType(BottomSheet).props.listProps;
  const page = (queryPages: number, entry: ExploreEntry) => {
    mockDiscovery = { ...mockDiscovery, queryPages, entries: [...mockDiscovery.entries, entry] };
    act(() => { renderer.update(<NappletOverlays />); });
  };
  page(1, choiceApp(1, 'profile'));
  page(1, choiceApp(2, 'profile'));
  page(1, choiceApp(3, 'profile'));
  expect(list().ListFooterComponent.props.children.type).toBe(ActivityIndicator);
  page(2, choiceApp(4, 'profile'));
  expect(list().ListFooterComponent.props.children.type).toBe(ActivityIndicator);
  page(3, choiceApp(5, 'profile'));
  expect(list().ListEmptyComponent).not.toBeNull();
  expect(list().ListFooterComponent.props.children).toBeNull();
  expect(mockDiscovery.hasMore).toBe(true);
  const requests = jest.mocked(loadMoreApplications).mock.calls.length;
  act(() => { list().onEndReached(); });
  expect(loadMoreApplications).toHaveBeenCalledTimes(requests);
  mockPrompt = { ...mockPrompt!, requestId: 'new-lookup' };
  act(() => { renderer.update(<NappletOverlays />); });
  expect(list().ListFooterComponent.props.children.type).toBe(ActivityIndicator);
  expect(jest.mocked(loadMoreApplications).mock.calls.length).toBeGreaterThan(requests);
});

it('resets the empty-page budget when a new compatible app arrives and keeps results at the limit', () => {
  mockDiscovery.hasMore = true;
  mockPrompt = automaticChoicePrompt();
  act(() => { renderer = create(<NappletOverlays />); });
  const list = () => renderer.root.findByType(BottomSheet).props.listProps;
  for (let queryPages = 1; queryPages <= 5; queryPages++) {
    mockDiscovery = { ...mockDiscovery, queryPages, entries: [...mockDiscovery.entries,
      choiceApp(queryPages, queryPages === 3 ? 'edit' : 'profile')] };
    act(() => { renderer.update(<NappletOverlays />); });
    expect(list().ListFooterComponent.props.children.type).toBe(ActivityIndicator);
  }
  mockDiscovery = { ...mockDiscovery, queryPages: 6, entries: [...mockDiscovery.entries, choiceApp(6, 'profile')] };
  act(() => { renderer.update(<NappletOverlays />); });
  expect(list().data.map((choice: { key: string }) => choice.key)).toEqual(['discovery:app-3']);
  expect(list().ListFooterComponent.props.children.props.children).toBe('applications.no_more_apps');
});

it('does not offer Discover for an unavailable explicit instance', () => {
  mockPrompt = { requestId: 'empty', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    choices: [], applicationSelection: { requester: 'Timeline', content: 'content', unavailable: 'instance' } };
  act(() => { renderer = create(<NappletOverlays />); });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'applications.handler_closed')).toBe(true);
  expect(renderer.root.findAllByType(AppButton).some(node => node.props.label === 'applications.view_other_apps')).toBe(false);
});

it('keeps the requester question when compatible applications can be selected', () => {
  mockPrompt = { requestId: 'choices', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    choices: [{ key: 'target', title: 'Target' }], applicationSelection: { requester: 'Timeline', content: 'content' } };
  act(() => { renderer = create(<NappletOverlays />); });
  expect(renderer.root.findByType(BottomSheet).props.fixedSubheader).toBeDefined();
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toEqual(['applications.open_with_content']);
});


it.each(['sign', 'publish', 'encrypt-publish'] as const)('uses ordinary signing wording for %s event decisions', operation => {
  act(() => { renderer = create(<SigningRequestDetails request={{ ...prompt.signing!, operation }} />); });
  const text = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(text).toContain('applications.signing_sign_event');
  expect(text).toContain('applications.signing_effect_sign');
  expect(text).not.toContain('applications.signing_effect_publish');
  expect(text).not.toContain('applications.signing_effect_encrypted');
});


it('uses the standard allow and reject duration controls for an application HTTP action', () => {
  const auth = { ...prompt, signing: { ...prompt.signing, operation: 'http-auth' as const, kind: 27235,
    relays: ['https://api.example'], tags: [['u', 'https://api.example/path'], ['method', 'POST']] } };
  act(() => { renderer = create(<SigningApproval prompt={auth} />); });
  expect(renderer.root.findAllByType(AppButton).filter(node => node.props.label === 'applications.signing_duration_once')).toHaveLength(1);
  selectDuration('allow-always');
  act(() => { button('applications.signing_reject_countdown').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'deny-always');
});


it.each([24242, 27235, 22242])('renders kind %s publication as an ordinary signature', kind => {
  act(() => { renderer = create(<SigningRequestDetails request={{ ...prompt.signing!, operation: 'sign', kind }} />); });
  const text = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(text).toContain('applications.signing_sign_event');
  expect(text).toContain('applications.signing_kind');
  expect(text).not.toContain('applications.signing_http_auth');
  expect(text).not.toContain('applications.signing_upload');
});
