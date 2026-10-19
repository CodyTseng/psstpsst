jest.mock('lucide-react-native/icons/external-link', () => () => null);
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { SigningApproval, SigningActions } from '../SigningApproval';
import { NappletOverlays } from '../NappletOverlays';
import { UploadApproval } from '../UploadApproval';
import { CapabilityApproval } from '../CapabilityApproval';
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

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
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

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/common/ActionMenuPanel', () => ({ ActionMenuPanel: () => null }));
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: () => ({ name: 'Alice', profile: null }) }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { answer: jest.fn(), rejectAllRequests: jest.fn(), closeConfiguration: jest.fn(), overlayClosed: jest.fn() } }));
jest.mock('@/platform', () => ({ platform: { deviceCrypto: { sha256Hex: jest.fn() }, clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } } }));
jest.mock('@/services/napplet/repository', () => ({ getData: jest.fn(), setData: jest.fn() }));

jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('../NappletPanel', () => ({ NappletPanel: () => null, NappletPanelActions: () => null }));
jest.mock('../NappletIcon', () => ({ NappletIcon: () => null }));
jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: ({ children, headerAction, fixedSubheader, fixedFooter, modalOverlay }: { children: React.ReactNode; headerAction: React.ReactNode; fixedSubheader: React.ReactNode; fixedFooter: React.ReactNode; modalOverlay: React.ReactNode }) => {
    const View = jest.requireActual('react-native').View;
    return <View>{headerAction}{fixedSubheader}{children}{fixedFooter}{modalOverlay}</View>;
  },
}));
let mockPrompt: QueuedPrompt | null = null;
jest.mock('@/stores/napplet.store', () => ({ useNapplets: () => ({ prompt: mockPrompt, configuration: null }) }));

let renderer: ReactTestRenderer;
const prompt = {
  requestId: 'request-A', expiresAt: Date.now() + 25000, queued: 0, title: 'Game', detail: '',
  signing: { operation: 'publish', kind: 1, accountPubkey: 'a'.repeat(64), content: 'Hello from the app', tags: [], createdAt: 100, relays: ['wss://relay.example/'] },
} satisfies QueuedPrompt;
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });
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
  act(() => { renderer = create(<CapabilityApproval prompt={capability} onPublisher={jest.fn()} />); });
  expect(renderer.root.findAllByType(AppButton).some((node) => node.props.label === 'napplets.capability_identity')).toBe(false);
  act(() => { void button('napplets.allow').props.onPress(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('request-A', 'domains:[]');
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
  const request = { ...prompt.signing!, kind: 30078, identifier: 'progress', content: JSON.stringify({ score: 120, level: 3, state: { opaque: true } }) };
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

it('closes the duration menu before dismissing the signing sheet', () => {
  mockPrompt = prompt;
  act(() => { renderer = create(<NappletOverlays />); });
  act(() => { renderer.root.findByType(SigningActions).props.onMenuChange({ x: 180, y: 700 }); });
  const sheet = renderer.root.findByType(jest.requireMock('@/components/common/BottomSheet').BottomSheet);
  act(() => { sheet.props.onClose(); });
  expect(renderer.root.findAllByType(ActionMenuPanel)).toHaveLength(0);
  expect(nappletService.rejectAllRequests).not.toHaveBeenCalled();
  act(() => { sheet.props.onClose(); });
  expect(nappletService.rejectAllRequests).toHaveBeenCalledTimes(1);
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
  [10001, [['d', 'actual-record']], 'd: "actual-record"'],
  [30078, [['d', 'actual-record']], 'd: "actual-record"'],
  [30078, [['d', '']], 'd: ""'],
  [30078, [], 'd: napplets.none'],
] as const)('shows kind %s and its applicable d tag before expanding details', (kind, tags, expected) => {
  const request = { ...prompt.signing!, kind, tags: tags.map((tag) => [...tag]), identifier: 'untrusted-derived-record' };
  act(() => { renderer = create(<SigningRequestDetails request={request} />); });
  const texts = renderer.root.findAllByType(AppText).map((node) => node.props.children);
  expect(texts).toContain('chat.event_reference.kind');
  expect(texts.filter((value) => typeof value === 'string' && value.startsWith('d:'))).toEqual(expected === null ? [] : [expected]);
  expect(texts.some((value) => typeof value === 'string' && value.includes('untrusted-derived-record'))).toBe(false);
  expect(renderer.root.findAllByType(AppText).some((node) => node.props.variant === 'code')).toBe(false);
});
