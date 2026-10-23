import { BrowserActions } from '../browser-actions';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import { readBrowserPermissions, saveBrowserPermissions } from '../browser-permission-store';
import { invalidateSigning } from '@/services/signing/changes';
import type { BrowserPermissionRule } from '../browser-permission-store';
jest.mock('@/i18n/core', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('../browser-permission-store', () => ({ readBrowserPermissions: jest.fn(async () => []), saveBrowserPermissions: jest.fn() }));
jest.mock('@/platform', () => ({ platform: {} }));

it('preserves the exact resource names and target in the host approval', async () => {
  const confirm = jest.fn<Promise<string | false>, [RuntimePrompt, AbortSignal]>(async () => 'allow');
  const actions = new BrowserActions({ application: { title: 'Site', description: '', required: [], servers: [] }, account: 'account', sourceId: 'https://site.example',
    signal: new AbortController().signal, confirm, open: jest.fn() });
  expect(await actions.approve({ action: 'permission', resources: ['mediaKeySystem', 'unknown-feature'] })).toBe(true);
  expect(confirm.mock.calls[0][0]).toMatchObject({
    browser: { action: 'permission', resources: ['mediaKeySystem', 'unknown-feature'] },
    detail: 'napplets.browser_protected_media\nnapplets.browser_permission: unknown-feature',
  });
  await actions.approve({ action: 'download', url: 'https://files.example/report.pdf', filename: 'report.pdf' });
  expect(confirm.mock.calls[1][0].browser).toEqual({ action: 'download', url: 'https://files.example/report.pdf', filename: 'report.pdf', resources: undefined });
});

function setup(answer: string | false = 'allow', sourceId = 'https://site.example', account = 'account') {
  const life = new AbortController();
  const confirm = jest.fn(async () => answer);
  const changed = jest.fn();
  const actions = new BrowserActions({ application: { title: 'Site', description: '', required: [], servers: [] }, account, sourceId,
    signal: life.signal, confirm, permissionsChanged: changed, open: jest.fn() });
  return { actions, confirm, life, changed };
}
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(readBrowserPermissions).mockResolvedValue([]);
  jest.mocked(saveBrowserPermissions).mockImplementation(async scope => invalidateSigning(scope, 'browser:*'));
});

it.each(['allow-always', 'allow-1h', 'deny-always'])('rechecks queued browser requests after a %s decision commits', async answer => {
  let saved: BrowserPermissionRule[] = [], decide!: (answer: string) => void, commit!: () => void;
  const committed = new Promise<void>(resolve => { commit = resolve; });
  jest.mocked(readBrowserPermissions).mockImplementation(async () => saved);
  jest.mocked(saveBrowserPermissions).mockImplementation(async (scope, resources, decision, expiresAt, guard) => {
    await committed; guard?.();
    saved = resources.map(resource => ({ resource, decision, expiresAt, updatedAt: Date.now() }));
    return invalidateSigning(scope, 'browser:*');
  });
  const first = setup(answer), second = setup(answer);
  first.confirm.mockImplementationOnce(() => new Promise<string>(resolve => { decide = resolve; }));
  try {
    const request = { action: 'permission' as const, resources: ['clipboard-read'] };
    const pending = [first.actions.approve(request), second.actions.approve(request)];
    while (!first.confirm.mock.calls.length) await Promise.resolve();
    decide(answer);
    await Promise.resolve();
    expect(second.confirm).not.toHaveBeenCalled();
    commit();
    expect(await Promise.all(pending)).toEqual([answer.startsWith('allow'), answer.startsWith('allow')]);
    expect(first.confirm).toHaveBeenCalledTimes(1);
    expect(second.confirm).not.toHaveBeenCalled();
    expect(saveBrowserPermissions).toHaveBeenCalledTimes(1);
  } finally { first.life.abort(); second.life.abort(); }
});

it('allows persistence and copy without displaying an approval or storing a grant', async () => {
  const { actions, confirm, life } = setup();
  for (const resource of ['persistent-storage', 'clipboard-write', 'clipboard-sanitized-write'])
    expect(await actions.approve({ action: 'permission', resources: [resource] })).toBe(true);
  expect(confirm).not.toHaveBeenCalled(); expect(saveBrowserPermissions).not.toHaveBeenCalled(); life.abort();
});
it('remembers individual sensitive capabilities using the selected duration and source', async () => {
  const { actions, confirm, life } = setup('allow-10m');
  const started = Date.now();
  expect(await actions.approve({ action: 'permission', resources: ['video', 'audio', 'video'] })).toBe(true);
  expect(saveBrowserPermissions).toHaveBeenCalledWith({ accountPubkey: 'account', sourceId: 'https://site.example' }, ['video', 'audio'], 'allow', expect.any(Number), expect.any(Function));
  const until = jest.mocked(saveBrowserPermissions).mock.calls[0][3]!;
  expect(until).toBeGreaterThanOrEqual(started + 600000); expect(until).toBeLessThanOrEqual(Date.now() + 600000);
  expect(confirm.mock.calls[0]).toBeDefined(); life.abort();
});
it('uses stored decisions, respects expiration and re-prompts after revocation', async () => {
  const { actions, confirm, life } = setup();
  jest.mocked(readBrowserPermissions).mockResolvedValue([{ resource: 'clipboard-read', decision: 'allow', expiresAt: Date.now() + 10000, updatedAt: 1 }]);
  const result = await actions.authorize({ action: 'permission', resources: ['clipboard-read'] });
  expect(result.allowed).toBe(true); expect(result.expiresAt).toBeGreaterThan(Date.now()); expect(confirm).not.toHaveBeenCalled();
  invalidateSigning({ accountPubkey: 'account', sourceId: 'https://site.example' });
  jest.mocked(readBrowserPermissions).mockResolvedValue([{ resource: 'clipboard-read', decision: 'allow', expiresAt: Date.now() - 1, updatedAt: 1 }]);
  await actions.approve({ action: 'permission', resources: ['clipboard-read'] }); expect(confirm).toHaveBeenCalledTimes(1);
  invalidateSigning({ accountPubkey: 'account', sourceId: 'https://site.example' });
  jest.mocked(readBrowserPermissions).mockResolvedValue([]);
  await actions.approve({ action: 'permission', resources: ['clipboard-read'] }); expect(confirm).toHaveBeenCalledTimes(2); life.abort();
});
it('records persistent refusals and automatically refuses only the stored resource', async () => {
  const { actions, confirm, life } = setup('deny-always');
  expect(await actions.approve({ action: 'permission', resources: ['geolocation'] })).toBe(false);
  expect(saveBrowserPermissions).toHaveBeenCalledWith(expect.anything(), ['geolocation'], 'deny', null, expect.any(Function));
  jest.mocked(readBrowserPermissions).mockResolvedValue([{ resource: 'geolocation', decision: 'deny', expiresAt: null, updatedAt: 1 }]);
  expect(await actions.approve({ action: 'permission', resources: ['geolocation'] })).toBe(false); expect(confirm).toHaveBeenCalledTimes(1); life.abort();
});
it('one-time grants last only for the current document and unknown/capture requests stay per-operation', async () => {
  const first = setup();
  await first.actions.approve({ action: 'permission', resources: ['audio'] });
  await first.actions.approve({ action: 'permission', resources: ['audio'] });
  expect(first.confirm).toHaveBeenCalledTimes(1); expect(saveBrowserPermissions).not.toHaveBeenCalled(); first.life.abort();
  const next = setup(); await next.actions.approve({ action: 'permission', resources: ['audio'] }); expect(next.confirm).toHaveBeenCalledTimes(1);
  for (const resource of ['display-capture', 'unknown-feature']) {
    const request = { action: 'permission' as const, resources: [resource] };
    await next.actions.approve(request); await next.actions.approve(request);
  }
  expect(next.confirm).toHaveBeenCalledTimes(5); expect(saveBrowserPermissions).not.toHaveBeenCalled(); next.life.abort();
});
it('does not broaden partial grants and does not reuse them for other accounts or websites', async () => {
  const { actions, confirm, life } = setup('allow-always');
  jest.mocked(readBrowserPermissions).mockResolvedValue([{ resource: 'video', decision: 'allow', expiresAt: null, updatedAt: 1 }]);
  await actions.approve({ action: 'permission', resources: ['video', 'audio'] });
  expect(saveBrowserPermissions).toHaveBeenCalledWith(expect.anything(), ['audio'], 'allow', null, expect.any(Function)); life.abort();
  jest.mocked(readBrowserPermissions).mockResolvedValue([]);
  for (const [source, account] of [['https://other.example', 'account'], ['https://site.example', 'other']]) {
    const other = setup('allow', source, account); await other.actions.approve({ action: 'permission', resources: ['video'] });
    expect(readBrowserPermissions).toHaveBeenLastCalledWith({ accountPubkey: account, sourceId: source }); expect(other.confirm).toHaveBeenCalledTimes(1); other.life.abort();
  }
  expect(confirm).toHaveBeenCalledTimes(1);
});
it('never saves a decision after its document closes or its permissions change during review', async () => {
  const { actions, confirm, life } = setup('allow-always');
  confirm.mockImplementationOnce(async () => { life.abort(); return 'allow-always'; });
  await expect(actions.approve({ action: 'permission', resources: ['audio'] })).rejects.toThrow();
  expect(saveBrowserPermissions).not.toHaveBeenCalled();
  const other = setup('allow-always'); other.confirm.mockImplementationOnce(async () => { invalidateSigning({ accountPubkey: 'account', sourceId: 'https://site.example' }); return 'allow-always'; });
  await expect(other.actions.approve({ action: 'permission', resources: ['audio'] })).rejects.toThrow('permissions-changed');
  expect(saveBrowserPermissions).not.toHaveBeenCalled(); other.life.abort();
});
