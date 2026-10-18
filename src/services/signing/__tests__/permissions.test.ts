import { connectSigningWindows } from '../changes';
import { SigningPermissions, signingRuleKey, type SigningRequest } from '../permissions';
import { saveSigningRule } from '../repository';
import { rules as stored, activity } from '../testing/memory-repository';

jest.mock('../repository', () => jest.requireActual('../testing/memory-repository').memoryRepository);
const controllers: AbortController[] = [];
const request: SigningRequest = {
  operation: 'publish', kind: 30078, relays: ['wss://one.example/'], identifier: 'progress',
  accountPubkey: 'accountA', content: 'private fixture content', tags: [['d', 'progress']], createdAt: 100,
};
function create(confirm = jest.fn(async () => 'allow-always' as string | false), account = 'accountA', source = 'app.example') {
  const abort = new AbortController(); controllers.push(abort);
  const permissions = new SigningPermissions(
    { accountPubkey: account, sourceId: source }, confirm, abort.signal, jest.fn(),
  );
  return { permissions, confirm, abort };
}
beforeEach(() => { stored.clear(); activity.clear(); jest.clearAllMocks(); });
afterEach(() => { controllers.splice(0).forEach((value) => value.abort()); });

test('editing a saved rule changes its decision immediately and asking removes all automatic authority', async () => {
  const value = create();
  await value.permissions.authorize(request);
  const rule = (await value.permissions.snapshot()).rules[0];
  await value.permissions.edit(rule, { decision: 'deny', duration: 'always' });
  await expect(value.permissions.authorize(request)).rejects.toThrow('permission-denied');
  expect(value.confirm).toHaveBeenCalledTimes(1);
  await value.permissions.edit(rule, { decision: 'ask', duration: 'always' });
  expect((await value.permissions.snapshot()).rules).toHaveLength(0);
  await value.permissions.authorize(request);
  expect(value.confirm).toHaveBeenCalledTimes(2);
});

test('edited expiry preserves the exact event kind and d tag', async () => {
  const value = create();
  await value.permissions.authorize(request);
  const rule = (await value.permissions.snapshot()).rules[0];
  const expiresAt = Date.now() + 600000;
  await value.permissions.edit(rule, { decision: 'allow', duration: 'timed', expiresAt });
  const reopened = create();
  expect((await reopened.permissions.snapshot()).rules[0]).toMatchObject({ scope: rule.scope, duration: 'timed', expiresAt });
  await reopened.permissions.authorize({ ...request, identifier: 'another-record', tags: [['d', 'another-record']] });
  expect(reopened.confirm).toHaveBeenCalledTimes(1);
});

test('invalid scopes or expired edits cannot install permissions', async () => {
  const value = create();
  const source = { key: signingRuleKey(request), scope: request };
  await expect(value.permissions.edit({ ...source, key: 'different' }, { decision: 'allow', duration: 'always' })).rejects.toThrow();
  await expect(value.permissions.edit(source, { decision: 'allow', duration: 'timed', expiresAt: Date.now() - 1 })).rejects.toThrow();
  const protectedScope = { ...request, kind: 24242 };
  await expect(value.permissions.edit({ key: signingRuleKey(protectedScope), scope: protectedScope }, { decision: 'allow', duration: 'always' })).rejects.toThrow();
  expect(saveSigningRule).not.toHaveBeenCalled();
});

test('an edit invalidates consent that was already waiting', async () => {
  let finish!: (answer: string) => void;
  const value = create(jest.fn(() => new Promise<string>((resolve) => { finish = resolve; })));
  const pending = value.permissions.authorize(request);
  while (!finish) await Promise.resolve();
  await value.permissions.edit({ key: signingRuleKey(request), scope: request }, { decision: 'deny', duration: 'always' });
  finish('allow-always');
  await expect(pending).rejects.toThrow('permission-denied');
  expect((await value.permissions.snapshot()).rules[0].decision).toBe('deny');
});

test('a failed write never activates an edited automatic allowance', async () => {
  const value = create();
  jest.mocked(saveSigningRule).mockRejectedValueOnce(new Error('disk-full'));
  await expect(value.permissions.edit({ key: signingRuleKey(request), scope: request }, { decision: 'allow', duration: 'always' })).rejects.toThrow('disk-full');
  await value.permissions.authorize(request);
  expect(value.confirm).toHaveBeenCalledTimes(1);
});

test('a failed edit retains the previously saved permission for future requests', async () => {
  const value = create();
  await value.permissions.authorize(request);
  const rule = (await value.permissions.snapshot()).rules[0];
  jest.mocked(saveSigningRule).mockRejectedValueOnce(new Error('disk-full'));
  await expect(value.permissions.edit(rule, { decision: 'deny', duration: 'always' })).rejects.toThrow('disk-full');
  await value.permissions.authorize(request);
  expect(value.confirm).toHaveBeenCalledTimes(1);
  expect((await value.permissions.snapshot()).rules[0].decision).toBe('allow');
});

test('rules survive sessions and remain isolated by account, source and d tag', async () => {
  const first = create();
  await first.permissions.authorize(request);
  const reopened = create();
  await reopened.permissions.authorize(request);
  expect(reopened.confirm).not.toHaveBeenCalled();
  const account = create(undefined, 'accountB');
  await account.permissions.authorize({ ...request, accountPubkey: 'accountB' });
  expect(account.confirm).toHaveBeenCalledTimes(1);
  const version = create(undefined, 'accountA', 'other.example');
  await version.permissions.authorize(request);
  expect(version.confirm).toHaveBeenCalledTimes(1);
  await first.permissions.authorize({ ...request, identifier: 'other', tags: [['d', 'other']] });
  await first.permissions.authorize({ ...request, relays: ['wss://two.example/'] });
  await reopened.permissions.authorize({ ...request, relays: ['wss://third.example/'] });
  expect(reopened.confirm).not.toHaveBeenCalled();
  expect(first.confirm).toHaveBeenCalledTimes(2);
  expect([...stored.values()].join('')).not.toContain(request.content);
});

test('session grants expire when the execution session ends', async () => {
  const first = create(jest.fn(async () => 'allow-session'));
  await first.permissions.authorize(request);
  await first.permissions.authorize(request);
  expect(first.confirm).toHaveBeenCalledTimes(1);
  first.abort.abort();
  const next = create();
  await next.permissions.authorize(request);
  expect(next.confirm).toHaveBeenCalledTimes(1);
});

test('relay AUTH and Blossom authentication are automatic and never create grants', async () => {
  const { permissions, confirm } = create();
  await permissions.authorize({ ...request, operation: 'relay-auth', kind: 22242 });
  await permissions.authorize({ ...request, operation: 'upload', kind: 24242 });
  expect(confirm).not.toHaveBeenCalled();
  expect(saveSigningRule).not.toHaveBeenCalled();
});

test('custom kinds remain one-time by default and support explicitly scoped permission or refusal', async () => {
  const unknown = { ...request, kind: 4567 };
  const first = create(jest.fn(async () => 'allow'));
  await first.permissions.authorize(unknown);
  await first.permissions.authorize(unknown);
  expect(first.confirm).toHaveBeenCalledTimes(2);
  const remembered = create();
  await remembered.permissions.authorize(unknown);
  await remembered.permissions.authorize(unknown);
  expect(remembered.confirm).toHaveBeenCalledTimes(1);
  const blocked = create(jest.fn(async () => 'deny-always'));
  // A fresh scope must still ask before remembering a denial.
  const blockedScope = { ...unknown, kind: 4568, relays: ['wss://other.example/'] };
  await expect(blocked.permissions.authorize(blockedScope)).rejects.toThrow('permission-denied');
  const next = create();
  await expect(next.permissions.authorize(blockedScope)).rejects.toThrow('permission-denied');
  expect(next.confirm).not.toHaveBeenCalled();
});

test('closing during consent cannot persist the late approval', async () => {
  let resolve!: (value: string) => void;
  const confirm = jest.fn(() => new Promise<string>((done) => { resolve = done; }));
  const { permissions, abort } = create(confirm);
  const pending = permissions.authorize(request);
  while (!confirm.mock.calls.length) await Promise.resolve();
  abort.abort(); resolve('allow-always');
  await expect(pending).rejects.toThrow();
  expect(saveSigningRule).not.toHaveBeenCalled();
});

test('a request that expires while being reviewed cannot create a grant', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const { permissions } = create(jest.fn(async () => { now.mockReturnValue(3000); return 'allow-always'; }));
    await expect(permissions.authorize(request, 2000)).rejects.toThrow('timeout');
    expect(saveSigningRule).not.toHaveBeenCalled();
  } finally { now.mockRestore(); }
});

test('a failed persistence operation cannot silently activate a remembered grant', async () => {
  const { permissions, confirm } = create();
  jest.mocked(saveSigningRule).mockRejectedValueOnce(new Error('disk-full'));
  await expect(permissions.authorize(request)).rejects.toThrow('disk-full');
  await permissions.authorize(request);
  expect(confirm).toHaveBeenCalledTimes(2);
});

test('time-limited approval survives reopening and expires at the exact deadline', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const first = create(jest.fn(async () => 'allow-10m'));
    await first.permissions.authorize(request);
    expect((await first.permissions.snapshot()).rules[0]).toMatchObject({ duration: 'timed', expiresAt: 601000 });
    const reopened = create();
    await reopened.permissions.authorize(request);
    expect(reopened.confirm).not.toHaveBeenCalled();
    now.mockReturnValue(601000);
    expect((await reopened.permissions.snapshot()).rules).toEqual([]);
    await reopened.permissions.authorize(request);
    expect(reopened.confirm).toHaveBeenCalledTimes(1);
  } finally { now.mockRestore(); }
});

test('a time-limited refusal blocks matching requests only until its expiry', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const first = create(jest.fn(async () => 'deny-1h'));
    await expect(first.permissions.authorize(request)).rejects.toThrow('permission-denied');
    const next = create();
    await expect(next.permissions.authorize(request)).rejects.toThrow('permission-denied');
    expect(next.confirm).not.toHaveBeenCalled();
    now.mockReturnValue(3601000);
    await next.permissions.authorize(request);
    expect(next.confirm).toHaveBeenCalledTimes(1);
  } finally { now.mockRestore(); }
});

test('unsupported duration values never authorize or create a rule', async () => {
  const { permissions } = create(jest.fn(async () => 'allow-999999999999'));
  await expect(permissions.authorize(request)).rejects.toThrow('permission-denied');
  expect((await permissions.snapshot()).rules).toEqual([]);
});

test('revoking an active permanent rule removes persisted and in-memory access', async () => {
  const first = create();
  await first.permissions.authorize(request);
  const rule = (await first.permissions.snapshot()).rules[0];
  await first.permissions.revoke(rule.key);
  expect((await first.permissions.snapshot()).rules).toEqual([]);
  await first.permissions.authorize(request);
  expect(first.confirm).toHaveBeenCalledTimes(2);
});

test('revocation invalidates an approval already waiting for user input', async () => {
  let finish!: (value: string) => void;
  const confirm = jest.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const { permissions } = create(confirm);
  const authorization = permissions.authorize(request);
  while (!confirm.mock.calls.length) await Promise.resolve();
  await permissions.revoke(signingRuleKey(request));
  finish('allow-always');
  await expect(authorization).rejects.toThrow('permission-denied');
  expect((await permissions.snapshot()).rules).toEqual([]);
});

test('all live sessions lose matching authority when a shared source rule is revoked', async () => {
  const first = create(); const second = create();
  await first.permissions.authorize(request);
  await second.permissions.authorize(request);
  const rule = (await first.permissions.snapshot()).rules[0];
  await first.permissions.revoke(rule.key);
  await second.permissions.authorize(request);
  expect(second.confirm).toHaveBeenCalledTimes(1);
});

test('a remote host invalidates cached authority without rebroadcasting its message', async () => {
  let receive!: (change: { accountPubkey: string; sourceId: string; key?: string }) => void;
  const broadcastSigning = jest.fn(async () => {});
  const detach = jest.fn();
  connectSigningWindows({ broadcastSigning, onSigningChange: (listener: typeof receive) => { receive = listener; return detach; } } as unknown as import('@/platform/ports/application-window').ApplicationWindowsPort);
  try {
    const value = create();
    await value.permissions.authorize(request);
    const rule = (await value.permissions.snapshot()).rules[0];
    const scope = { accountPubkey: 'accountA', sourceId: 'https://app.example' };
    stored.set(JSON.stringify(scope), [{ ...rule, decision: 'deny' }]);
    broadcastSigning.mockClear();
    receive({ ...scope, key: rule.key });
    await expect(value.permissions.authorize(request)).rejects.toThrow('permission-denied');
    expect(broadcastSigning).not.toHaveBeenCalled();
    expect(value.confirm).toHaveBeenCalledTimes(1);
  } finally { connectSigningWindows(); }
  expect(detach).toHaveBeenCalledTimes(1);
});
