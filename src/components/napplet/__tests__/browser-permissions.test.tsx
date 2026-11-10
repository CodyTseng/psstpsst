import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BrowserPermissions } from '../BrowserPermissions';
import { PermissionRuleEditor } from '../SigningRuleEditor';
import { AppText } from '@/components/common/AppText';
import { ListRow } from '@/components/common/ListRow';
import { clearBrowserPermissions, saveBrowserPermissions } from '@/services/explore/browser-permission-store';

let mockTrusted = false;
let mockRules = [{ resource: 'clipboard-read', decision: 'allow' as const, expiresAt: null, updatedAt: 1 }];
jest.mock('@/i18n', () => ({ language: 'en', resolvedLanguage: 'en', t: (key: string) => key }));
jest.mock('@/hooks/use-browser-permissions', () => ({ useBrowserPermissions: () => ({ rules: mockRules, authorization: { fullyTrusted: mockTrusted } }) }));
jest.mock('@/stores/napplet.store', () => ({ useNappletAccountPubkey: () => 'account' }));
jest.mock('@/services/explore/browser-permission-store', () => ({ clearBrowserPermissions: jest.fn(), saveBrowserPermissions: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: {} }) }));
jest.mock('../SigningRuleEditor', () => ({ PermissionRuleEditor: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: () => null }));
jest.mock('@/components/common/ListGroup', () => ({ ListGroup: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('@/theme', () => ({ spacing: { md: 12, lg: 16 }, useThemeColors: () => ({ accent: 'accent', textMuted: 'muted' }) }));
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer.unmount()); jest.clearAllMocks(); });
it('edits the individual website permission and can restore asking', async () => {
  act(() => { renderer = create(<BrowserPermissions accountPubkey="account" sourceId="https://site.example" />); });
  const row = renderer.root.findByType(ListRow);
  expect(row.props.title).toBe('applications.browser_clipboard_read');
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toEqual(['applications.browser_permission']);
  act(() => { row.props.onPress(); });
  const editor = renderer.root.findByType(PermissionRuleEditor);
  await act(async () => editor.props.onSave({ decision: 'deny', duration: 'timed', expiresAt: 999999 }));
  expect(saveBrowserPermissions).toHaveBeenCalledWith({ accountPubkey: 'account', sourceId: 'https://site.example' }, ['clipboard-read'], 'deny', 999999);
  await act(async () => editor.props.onSave({ decision: 'ask', duration: 'always' }));
  expect(clearBrowserPermissions).toHaveBeenCalledWith({ accountPubkey: 'account', sourceId: 'https://site.example' }, 'clipboard-read');
});

it('edits and revokes the saved wallet information permission through application settings', async () => {
  mockRules = [{ resource: 'webln-info', decision: 'allow', expiresAt: null, updatedAt: 1 }];
  act(() => { renderer = create(<BrowserPermissions accountPubkey="account" sourceId="https://site.example" />); });
  const row = renderer.root.findByType(ListRow);
  expect(row.props.title).toBe('webln.access_title');
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toEqual(['wallet.title']);
  act(() => { row.props.onPress(); });
  const editor = renderer.root.findByType(PermissionRuleEditor);
  await act(async () => editor.props.onSave({ decision: 'deny', duration: 'timed', expiresAt: 999999 }));
  expect(saveBrowserPermissions).toHaveBeenCalledWith({ accountPubkey: 'account', sourceId: 'https://site.example' }, ['webln-info'], 'deny', 999999);
  await act(async () => editor.props.onSave({ decision: 'ask', duration: 'always' }));
  expect(clearBrowserPermissions).toHaveBeenCalledWith({ accountPubkey: 'account', sourceId: 'https://site.example' }, 'webln-info');
});

it('pauses wallet exceptions under full trust while retaining independent permissions', () => {
  mockRules = [{ resource: 'webln-info', decision: 'allow', expiresAt: null, updatedAt: 1 },
    { resource: 'clipboard-read', decision: 'allow', expiresAt: null, updatedAt: 1 }];
  mockTrusted = true;
  act(() => { renderer = create(<BrowserPermissions accountPubkey="account" sourceId="https://site.example" />); });
  expect(renderer.root.findAllByType(ListRow).map(row => row.props.title)).toEqual(['webln.access_title', 'applications.browser_clipboard_read']);
  expect(renderer.root.findAllByType(ListRow)[0].props.disabled).toBe(true);
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).toEqual([
    'wallet.title', 'applications.fully_trust_wallet', 'applications.browser_permission',
  ]);
  mockTrusted = false;
  act(() => { renderer.update(<BrowserPermissions accountPubkey="account" sourceId="https://site.example" />); });
  expect(renderer.root.findAllByType(ListRow).map(row => row.props.title)).toEqual(['webln.access_title', 'applications.browser_clipboard_read']);
});

it('closes an open wallet exception editor when full trust is enabled', () => {
  mockTrusted = false;
  mockRules = [{ resource: 'webln-info', decision: 'allow', expiresAt: null, updatedAt: 1 }];
  act(() => { renderer = create(<BrowserPermissions accountPubkey="account" sourceId="https://site.example" />); });
  act(() => { renderer.root.findByType(ListRow).props.onPress(); });
  expect(renderer.root.findAllByType(PermissionRuleEditor)).toHaveLength(1);
  mockTrusted = true;
  act(() => { renderer.update(<BrowserPermissions accountPubkey="account" sourceId="https://site.example" />); });
  expect(renderer.root.findAllByType(PermissionRuleEditor)).toHaveLength(0);
  mockTrusted = false;
  act(() => { renderer.update(<BrowserPermissions accountPubkey="account" sourceId="https://site.example" />); });
  expect(renderer.root.findAllByType(PermissionRuleEditor)).toHaveLength(0);
});
