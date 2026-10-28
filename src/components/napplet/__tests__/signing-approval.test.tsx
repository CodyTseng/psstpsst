import { getNappletAccountPubkey } from '@/stores/napplet.store';
import { router } from 'expo-router';
import { BottomSheet } from '@/components/common/BottomSheet';
import { useExploreSearchHandoffStore } from '@/stores/explore-search-handoff.store';
import { WalletApproval } from '../WalletApproval';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
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
import { darkPalette, lightPalette } from '@/theme';

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
jest.mock('../NappletIcon', () => ({ NappletIcon: () => null }));
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
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); mockApprovalClosing = false; mockActiveAccount = 'a'.repeat(64); useExploreSearchHandoffStore.setState({ pending: null }); });
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
  expect(text).toContain('napplets.signing_effect_upload');
  expect(text).toContain('card.png'); expect(text).toContain('storage.example');
  expect(renderer.root.findAllByType(SigningActions)).toHaveLength(0);
  for (const content of ['card.png', 'storage.example', 'napplets.signing_effect_upload'])
    expect(renderer.root.findAllByType(AppText).find((node) => node.props.children === content)!.props.selectable).toBe(false);
  act(() => { void button('napplets.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'allow');
});

it.each(['light', 'dark'] as const)('binds scope selection and approval to the displayed request in %s mode', (scheme) => {
  mockScheme = scheme;
  act(() => { renderer = create(<SigningApproval prompt={prompt} />); });
  const content = renderer.root.findAllByType(AppText).find((node) => node.props.children === prompt.signing!.content)!;
  expect(StyleSheet.flatten(content.findByType(Text).props.style).color).toBe((scheme === 'dark' ? darkPalette : lightPalette).text);
  selectDuration('allow-always');
  act(() => { void button('napplets.signing_approve').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'allow-always');
  act(() => { renderer.update(<SigningApproval key="request-B" prompt={{ ...prompt, requestId: 'request-B' }} />); });
  act(() => { void button('napplets.signing_approve').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-B', 'allow');
});

it('uses exactly two side-by-side decisions and applies the selected time to refusal', () => {
  act(() => { renderer = create(<SigningApproval prompt={prompt} />); });
  selectDuration('allow-1h');
  expect(renderer.root.findByType(ActionRow).props.layout).toBe('horizontal');
  expect(renderer.root.findAllByType(AppButton).filter((node) => node.props.label === 'napplets.signing_block')).toHaveLength(0);
  act(() => { void button('napplets.signing_reject_countdown').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'deny-1h');
});

it('omits optional capabilities from launch consent and grants only required access', () => {
  const capability = { ...prompt, signing: undefined, capabilities: { required: ['shell'], optional: ['identity'] } };
  act(() => { renderer = create(<CapabilityApproval prompt={capability} />); });
  expect(renderer.root.findAllByType(AppButton).some((node) => node.props.label === 'napplets.capability_identity')).toBe(false);
  act(() => { void button('napplets.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'domains:[]');
});

it.each(['light', 'dark'] as const)('reviews the requested optional capability with explicit Allow/Reject in %s mode', scheme => {
  mockScheme = scheme;
  const capability = { ...prompt, signing: undefined,
    capabilities: { required: ['config'], optional: [], requested: 'config' } };
  act(() => { renderer = create(<CapabilityApproval prompt={capability} />); });
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toContain('napplets.capability_config');
  act(() => { void button('napplets.signing_reject').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'deny');
  act(() => { void button('napplets.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'allow');
});

it('keeps the fixed footer bound to its request and resets duration before a new request is displayed', () => {
  mockPrompt = prompt;
  act(() => { renderer = create(<NappletOverlays />); });
  selectDuration('allow-always');
  const previousApprove = button('napplets.signing_approve').props.onPress;
  mockPrompt = { ...prompt, requestId: 'new-request' };
  act(() => { renderer.update(<NappletOverlays />); });
  act(() => { void button('napplets.signing_approve').props.onPress(); });
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
  act(() => { void button('napplets.signing_details').props.onPress(); });
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
  act(() => { void button('napplets.signing_details').props.onPress(); });
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
  act(() => { button('napplets.signing_details').props.onPress(); });
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
  act(() => { button('napplets.signing_details').props.onPress(); });
  const texts = renderer.root.findAllByType(AppText);
  expect(texts.some((node) => node.props.children === request.content)).toBe(true);
  expect(texts.some((node) => node.props.children === 'wss://relay.example/')).toBe(true);
  for (const text of texts.filter((node) => node.props.children !== 'napplets.signing_hide_details' && node.props.children !== 'common.copy')) {
    expect(text.props.selectable).toBe(false);
    expect(StyleSheet.flatten(text.props.style).userSelect).toBe('none');
  }
});

it.each([
  [1, [['d', 'actual-record']], null],
  [3, [['d', 'actual-record']], null],
  [10001, [['d', 'actual-record']], null],
  [30078, [['d', 'actual-record']], 'actual-record'],
  [30078, [['d', '']], 'napplets.signing_unnamed'],
  [30078, [], 'napplets.none'],
] as const)('shows kind %s and its applicable d tag before expanding details', (kind, tags, expected) => {
  const request = { ...prompt.signing!, kind, tags: tags.map((tag) => [...tag]), scopeKey: 'untrusted-derived-record' };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const texts = renderer.root.findAllByType(AppText).map((node) => node.props.children);
  expect(texts).toContain('napplets.signing_kind');
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
  expect(texts).not.toContain('napplets.signing_content');
  expect(texts).not.toContain('napplets.none');
  expect(texts).not.toContain('d');
});

it('keeps launch permissions focused on required capabilities with a fixed decision footer', () => {
  mockPrompt = { ...prompt, signing: undefined, queued: 12, accountPubkey: 'a'.repeat(64),
    application: { title: 'Armada', description: 'Marketing copy must stay out of this decision', required: ['network', 'storage'], servers: [], publisher: 'b'.repeat(64) } };
  act(() => { renderer = create(<NappletOverlays />); });
  const sheet = renderer.root.findByType(jest.requireMock('@/components/common/BottomSheet').BottomSheet);
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).not.toContain('napplets.signing_queued');
  expect(button('napplets.signing_reject_all')).toBeUndefined();
  expect(texts).not.toContain(mockPrompt.application!.description);
  expect(texts).toContain('napplets.capability_resource');
  expect(texts).toContain('napplets.capability_storage');
  expect(renderer.root.findByType(CapabilityApproval).props.hideActions).toBe(true);
  expect(sheet.props.dismissOnBackdropPress).toBe(false);
  expect(sheet.props.fixedFooter).toBeDefined();
  expect(renderer.root.findByType(SigningAccountAvatar).props.pubkey).toBe('a'.repeat(64));
  act(() => { button('napplets.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith(prompt.requestId, 'allow');
  mockPrompt = null;
});

it('shows the concrete browser permission without unrelated application requirements', () => {
  const browser = { ...prompt, signing: undefined, browser: { action: 'permission' as const, resources: ['mediaKeySystem', 'unrecognized-feature'] },
    application: { title: 'Armada', description: '', required: ['network'], servers: [] } };
  act(() => { renderer = create(<CapabilityApproval prompt={browser} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain('napplets.browser_protected_media');
  expect(texts).toContain('napplets.browser_permission: unrecognized-feature');
  expect(texts).not.toContain('napplets.capability_resource');
});

it.each(['u', 'url'])('shows the event type and HTTP authentication target from %s before opening event JSON', tag => {
  const request = { ...prompt.signing!, operation: 'sign' as const, kind: 27235, content: '',
    tags: [[tag, 'https://service.example/upload'], ['method', 'POST']] };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts.some(value => typeof value === 'string' && value.includes('napplets.event_http_auth'))).toBe(true);
  expect(texts).toContain('https://service.example/upload');
  expect(texts).toContain('napplets.signing_url');
  expect(texts).toContain('POST');
  expect(texts).not.toContain('napplets.none');
});

it.each(['light', 'dark'] as const)('keeps the full HTTP authentication URL visible beyond reference limits in %s mode', scheme => {
  mockScheme = scheme;
  const url = `https://service.example/upload?token=${'a'.repeat(300)}`;
  const request = { ...prompt.signing!, operation: 'sign' as const, kind: 27235, content: '',
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
  expect(texts.some(value => typeof value === 'string' && value.includes('napplets.event_profile'))).toBe(true);
  expect(texts).toContain('Cody'); expect(texts).toContain('Hello');
});

it.each(['get-public-key', 'nip44-encrypt', 'nip04-decrypt'] as const)('reviews %s without peer or event metadata', operation => {
  const request = { operation, relays: [], accountPubkey: 'a'.repeat(64), content: '', tags: [], createdAt: 1 };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).not.toContain('chat.event_reference.kind');
  expect(button('napplets.signing_details')).toBeUndefined();
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
  expect(button('napplets.signing_period_1h')).toBeDefined();
  act(() => { button('napplets.signing_approve').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith(prompt.requestId, 'allow-1h');
  act(() => { button('napplets.signing_reject_countdown').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith(prompt.requestId, 'deny-1h');
});

it.each(['nip04-encrypt', 'nip44-encrypt'] as const)('shows the original plaintext in %s approval', operation => {
  const text = '  Exact original\n{"literal":"<message>"}  ';
  act(() => { renderer = create(<SigningRequestDetails request={{ ...prompt.signing!, operation, kind: undefined, recipient: undefined, content: text }} />); });
  const texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain('napplets.crypto_plaintext'); expect(texts).toContain(text);
});
it('bounds long plaintext until expanded and copies the complete original', async () => {
  const text = 'Private original\n'.repeat(100);
  const request = { ...prompt.signing!, operation: 'nip44-encrypt' as const, kind: undefined, recipient: undefined, content: text };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  let texts = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(texts).toContain(text.slice(0, 600)); expect(texts).not.toContain(text);
  await act(async () => { button('common.copy').props.onPress(); });
  expect(platform.clipboard.writeText).toHaveBeenCalledWith(text);
  act(() => { button('napplets.signing_details').props.onPress(); });
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

it.each(['light', 'dark'] as const)('opens Discover without an initialized napplet account in %s mode', scheme => {
  mockScheme = scheme;
  mockPrompt = { requestId: 'empty', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    accountPubkey: 'a'.repeat(64), choices: [], applicationSelection: { requester: 'Timeline', content: 'content', discovery: { name: 'edit', auxiliary: false } } };
  act(() => { renderer = create(<NappletOverlays />); });
  const sheet = renderer.root.findByType(BottomSheet);
  expect(sheet.props.fixedSubheader).toBeUndefined();
  const text = renderer.root.findAllByType(AppText);
  expect(text.map(node => node.props.children)).toEqual(['napplets.open_with_empty', 'napplets.discover']);
  expect(text[0].props).toMatchObject({ children: 'napplets.open_with_empty', variant: 'body', tone: 'muted' });
  expect(button('napplets.discover')).toBeDefined();
  expect(renderer.root.findAllByType(AppButton).some(node => node.props.label === 'common.cancel')).toBe(false);
  expect(getNappletAccountPubkey()).toBeNull();
  act(() => { button('napplets.discover').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('empty', false);
  expect(router.navigate).not.toHaveBeenCalled();
  act(() => { renderer.root.findByType(BottomSheet).props.onClosed(); });
  expect(useExploreSearchHandoffStore.getState().pending).toMatchObject({ account: 'a'.repeat(64), action: { name: 'edit', auxiliary: false } });
  expect(router.navigate).toHaveBeenCalledWith({ pathname: '/napplets', params: { searchHandoff: expect.any(String) } });
});

it('does not offer Discover for an unavailable explicit instance', () => {
  mockPrompt = { requestId: 'empty', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    choices: [], applicationSelection: { requester: 'Timeline', content: 'content', unavailable: 'instance' } };
  act(() => { renderer = create(<NappletOverlays />); });
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'napplets.handler_closed')).toBe(true);
  expect(renderer.root.findAllByType(AppButton).some(node => node.props.label === 'napplets.discover')).toBe(false);
});

it('discards a Discover handoff when the active account changes during dismissal', () => {
  mockPrompt = { requestId: 'empty', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    accountPubkey: 'a'.repeat(64), choices: [], applicationSelection: { requester: 'Timeline', content: 'content', discovery: { name: 'edit', auxiliary: false } } };
  act(() => { renderer = create(<NappletOverlays />); });
  act(() => { button('napplets.discover').props.onPress(); });
  mockActiveAccount = 'b'.repeat(64);
  act(() => { renderer.root.findByType(BottomSheet).props.onClosed(); });
  expect(router.navigate).not.toHaveBeenCalled();
  expect(useExploreSearchHandoffStore.getState().pending).toBeNull();
});

it('keeps the requester question when compatible applications can be selected', () => {
  mockPrompt = { requestId: 'choices', expiresAt: Date.now() + 60000, queued: 0, title: 'Timeline', detail: '',
    choices: [{ key: 'target', title: 'Target' }], applicationSelection: { requester: 'Timeline', content: 'content' } };
  act(() => { renderer = create(<NappletOverlays />); });
  expect(renderer.root.findByType(BottomSheet).props.fixedSubheader).toBeDefined();
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toEqual(['napplets.open_with_content']);
});
