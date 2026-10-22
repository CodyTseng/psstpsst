import { ApplicationSigner } from '../application-signer';
import type { Signer } from '@/services/signer/signer.interface';
import { connectSigningWindows } from '../changes';
import { SigningPermissions, signingRuleKey, type SigningRequest } from '../permissions';
import { saveSigningRule } from '../repository';
import { rules as stored, activity } from '../testing/memory-repository';
import { PromptQueue, type QueuedPrompt } from '@/services/napplet/prompt-queue';

jest.mock('../repository', () => jest.requireActual('../testing/memory-repository').memoryRepository);
const controllers: AbortController[] = [];
const request: SigningRequest = {
  operation: 'publish', kind: 30078, relays: ['wss://one.example/'], scopeKey: 'progress',
  accountPubkey: 'accountA', content: 'private fixture content', tags: [['d', 'progress']], createdAt: 100,
};
function create(confirm: jest.Mock = jest.fn(async () => 'allow-always' as string | false), account = 'accountA', source = 'app.example') {
  const abort = new AbortController(); controllers.push(abort);
  const permissions = new SigningPermissions(
    { accountPubkey: account, sourceId: source }, confirm, abort.signal, jest.fn(),
  );
  return { permissions, confirm, abort };
}
beforeEach(() => { stored.clear(); activity.clear(); jest.clearAllMocks(); });
afterEach(() => { controllers.splice(0).forEach((value) => value.abort()); });

test.each(['allow-always', 'allow-10m', 'deny-always', 'deny-1h'])('%s dismisses once and rechecks matching queued requests across controllers', async decision => {
  let visible: QueuedPrompt | null = null, presentations = 0;
  const queue = new PromptQueue(value => { visible = value; if (value) presentations++; });
  const confirm = jest.fn((request: SigningRequest, signal?: AbortSignal) => queue.ask({ title: 'App', detail: '', signing: request }, signal));
  const first = create(confirm), second = create(confirm);
  const requests = [first.permissions.authorize(request), second.permissions.authorize(request), first.permissions.authorize(request)];
  const results = Promise.allSettled(requests);
  while (!visible) await Promise.resolve();
  queue.answer((visible as QueuedPrompt).requestId, decision);
  expect(visible).toBeNull();
  expect(stored.size).toBe(0);
  queue.dismissed();
  const outcomes = await results;
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(presentations).toBe(1);
  expect(visible).toBeNull();
  expect(outcomes.every(result => result.status === (decision.startsWith('allow') ? 'fulfilled' : 'rejected'))).toBe(true);
});

test('one-time permission decisions still review each queued request after dismissal', async () => {
  let visible: QueuedPrompt | null = null;
  const queue = new PromptQueue(value => { visible = value; });
  const confirm = jest.fn((request: SigningRequest, signal?: AbortSignal) => queue.ask({ title: 'App', detail: '', signing: request }, signal));
  const value = create(confirm);
  const first = value.permissions.authorize(request), second = value.permissions.authorize(request);
  while (!visible) await Promise.resolve();
  queue.answer((visible as QueuedPrompt).requestId, 'allow');
  expect(visible).toBeNull(); queue.dismissed();
  await first;
  while (!visible) await Promise.resolve();
  expect(confirm).toHaveBeenCalledTimes(2);
  queue.answer((visible as QueuedPrompt).requestId, 'allow'); queue.dismissed();
  await second;
});

test('queued requests only reuse an exactly matching permission scope', async () => {
  const value = create();
  await Promise.all([value.permissions.authorize(request),
    value.permissions.authorize({ ...request, tags: [['d', 'another-record']] }),
    value.permissions.authorize(request)]);
  expect(value.confirm).toHaveBeenCalledTimes(2);
  expect((await value.permissions.snapshot()).rules).toHaveLength(2);
});

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
  await reopened.permissions.authorize({ ...request, scopeKey: 'another-record', tags: [['d', 'another-record']] });
  expect(reopened.confirm).toHaveBeenCalledTimes(1);
});

test('invalid scopes or expired edits cannot install permissions', async () => {
  const value = create();
  const source = { key: signingRuleKey(request), scope: request };
  await expect(value.permissions.edit({ ...source, key: 'different' }, { decision: 'allow', duration: 'always' })).rejects.toThrow();
  await expect(value.permissions.edit(source, { decision: 'allow', duration: 'timed', expiresAt: Date.now() - 1 })).rejects.toThrow();
  const invalidScope = { ...request, kind: 65536 };
  await expect(value.permissions.edit({ key: signingRuleKey(invalidScope), scope: invalidScope }, { decision: 'allow', duration: 'always' })).rejects.toThrow();
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
  await first.permissions.authorize({ ...request, scopeKey: 'other', tags: [['d', 'other']] });
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

test('relay AUTH and uploads use independent remembered operation permissions', async () => {
  const { permissions, confirm } = create();
  await permissions.authorize({ ...request, operation: 'relay-auth', kind: 22242 });
  await permissions.authorize({ ...request, operation: 'upload', kind: 24242, relays: ['https://media.example/'] });
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(saveSigningRule).toHaveBeenCalledTimes(2);
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

test('remembered relay AUTH covers other relays for the same account and source', async () => {
  const auth: SigningRequest = { ...request, operation: 'relay-auth', kind: 22242, scopeKey: undefined, relays: ['wss://one.example/'] };
  const first = create();
  await first.permissions.authorize(auth);
  await first.permissions.authorize({ ...auth, relays: ['wss://two.example/'] });
  expect(first.confirm).toHaveBeenCalledTimes(1);
  const saved = (await first.permissions.snapshot()).rules[0];
  expect(saved.scope).toEqual({ operation: 'relay-auth', kind: 22242, relays: [] });
  const reopened = create();
  await reopened.permissions.authorize({ ...auth, relays: ['wss://third.example/path'] });
  expect(reopened.confirm).not.toHaveBeenCalled();
  const otherSource = create(undefined, 'accountA', 'another.example');
  await otherSource.permissions.authorize(auth);
  expect(otherSource.confirm).toHaveBeenCalledTimes(1);
  const otherAccount = create(undefined, 'accountB');
  await otherAccount.permissions.authorize({ ...auth, accountPubkey: 'accountB' });
  expect(otherAccount.confirm).toHaveBeenCalledTimes(1);
  await first.permissions.revoke(saved.key);
  await reopened.permissions.authorize(auth);
  expect(reopened.confirm).toHaveBeenCalledTimes(1);
});

test('relay AUTH refusals cover all relays and remain editable without a stored destination', async () => {
  const auth: SigningRequest = { ...request, operation: 'relay-auth', kind: 22242, scopeKey: undefined };
  const value = create(jest.fn(async () => 'deny-always'));
  await expect(value.permissions.authorize(auth)).rejects.toThrow('permission-denied');
  const rule = (await value.permissions.snapshot()).rules[0];
  const reopened = create();
  await expect(reopened.permissions.authorize({ ...auth, relays: ['wss://other.example/'] })).rejects.toThrow('permission-denied');
  expect(reopened.confirm).not.toHaveBeenCalled();
  await reopened.permissions.edit(rule, { decision: 'allow', duration: 'always' });
  await reopened.permissions.authorize({ ...auth, relays: ['wss://another.example/'] });
  expect(reopened.confirm).not.toHaveBeenCalled();
});

test('one-time AUTH still asks for every request and validates its actual target', async () => {
  const auth: SigningRequest = { ...request, operation: 'relay-auth', kind: 22242, scopeKey: undefined };
  const value = create(jest.fn(async () => 'allow'));
  await value.permissions.authorize(auth);
  await value.permissions.authorize({ ...auth, relays: ['wss://two.example/'] });
  expect(value.confirm).toHaveBeenCalledTimes(2);
  for (const relays of [[], ['https://wrong.example/']])
    await expect(value.permissions.authorize({ ...auth, relays })).rejects.toThrow('invalid-signing-request');
});

test('upload grants continue to distinguish storage services', async () => {
  const upload: SigningRequest = { ...request, operation: 'upload', kind: 24242, scopeKey: undefined, relays: ['https://one.example/'] };
  const value = create();
  await value.permissions.authorize(upload);
  await value.permissions.authorize({ ...upload, relays: ['https://two.example/'] });
  await value.permissions.authorize(upload);
  expect(value.confirm).toHaveBeenCalledTimes(2);
});

test('generic scope keys distinguish grants for the same event kind', async () => {
  const scoped: SigningRequest = { ...request, kind: 12345, tags: [], scopeKey: 'resource-one' };
  const value = create();
  await value.permissions.authorize(scoped);
  await value.permissions.authorize({ ...scoped, scopeKey: 'resource-two' });
  await value.permissions.authorize(scoped);
  expect(value.confirm).toHaveBeenCalledTimes(2);
  expect((await value.permissions.snapshot()).rules.map(rule => rule.scope.scopeKey)).toEqual(['resource-one', 'resource-two']);
});

test.each(['nip04', 'nip44'] as const)('%s encryption reviews the exact plaintext without retaining it in grants or history', async algorithm => {
  const text = '  Private original\n{"literal":"<message>"}  ';
  const { permissions, confirm } = create();
  const encrypt = jest.fn(async () => 'encrypted-payload');
  const signer = new ApplicationSigner({ accountPubkey: 'accountA', permissions, current: jest.fn(),
    signer: async () => ({ nip04Encrypt: encrypt, nip44Encrypt: encrypt }) as unknown as Signer });
  await expect(signer.crypto(algorithm, 'encrypt', 'b'.repeat(64), text)).resolves.toBe('encrypted-payload');
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ operation: `${algorithm}-encrypt`, content: text }), expect.anything());
  expect(confirm).toHaveBeenCalledWith(expect.not.objectContaining({ recipient: expect.anything() }), expect.anything());
  expect(encrypt).toHaveBeenCalledWith('b'.repeat(64), text);
  expect(JSON.stringify([...stored.values()])).not.toContain('Private original');
  expect(JSON.stringify([...activity.values()])).not.toContain('Private original');
  expect(JSON.stringify(await permissions.snapshot())).not.toContain('Private original');
});
test('rejecting plaintext review prevents the signer from encrypting it', async () => {
  const { permissions, confirm } = create(jest.fn(async () => false));
  const obtainSigner = jest.fn();
  const signer = new ApplicationSigner({ accountPubkey: 'accountA', permissions, current: jest.fn(), signer: obtainSigner });
  await expect(signer.crypto('nip44', 'encrypt', 'b'.repeat(64), 'do not encrypt')).rejects.toThrow('permission-denied');
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ content: 'do not encrypt' }), expect.anything());
  expect(obtainSigner).not.toHaveBeenCalled();
});

test.each(['allow-always', 'allow-10m', 'deny-always'])('%s crypto decisions apply across peers and survive reopening', async decision => {
  const first = create(jest.fn(async () => decision));
  const decrypt = jest.fn(async () => 'readable content');
  const use = (permissions: SigningPermissions) => new ApplicationSigner({ accountPubkey: 'accountA', permissions,
    current: jest.fn(), signer: async () => ({ nip44Decrypt: decrypt }) as unknown as Signer });
  for (const peer of ['b'.repeat(64), 'c'.repeat(64)]) {
    const request = use(first.permissions).crypto('nip44', 'decrypt', peer, 'encrypted payload');
    if (decision === 'deny-always') await expect(request).rejects.toThrow('permission-denied');
    else await expect(request).resolves.toBe('readable content');
  }
  expect(first.confirm).toHaveBeenCalledTimes(1);
  expect((await first.permissions.snapshot()).rules[0].scope).toEqual({ operation: 'nip44-decrypt', relays: [] });
  const reopened = create();
  const request = use(reopened.permissions).crypto('nip44', 'decrypt', 'd'.repeat(64), 'encrypted payload');
  if (decision === 'deny-always') { await expect(request).rejects.toThrow('permission-denied'); expect(decrypt).not.toHaveBeenCalled(); }
  else await expect(request).resolves.toBe('readable content');
  expect(reopened.confirm).not.toHaveBeenCalled();
});

test('crypto rules keep methods, algorithms, applications and accounts independent', async () => {
  const first = create();
  for (const operation of ['nip04-encrypt', 'nip04-decrypt', 'nip44-encrypt', 'nip44-decrypt'] as const) {
    await first.permissions.authorizeAccess(operation);
    await first.permissions.authorizeAccess(operation);
  }
  expect(first.confirm).toHaveBeenCalledTimes(4);
  const otherApp = create(undefined, 'accountA', 'other.example');
  await otherApp.permissions.authorizeAccess('nip44-decrypt');
  expect(otherApp.confirm).toHaveBeenCalledTimes(1);
  const otherAccount = create(undefined, 'accountB');
  await otherAccount.permissions.authorizeAccess('nip44-decrypt');
  expect(otherAccount.confirm).toHaveBeenCalledTimes(1);
});

test('invalid crypto peers still fail before asking for authorization', async () => {
  const { permissions, confirm } = create();
  const obtainSigner = jest.fn();
  const signer = new ApplicationSigner({ accountPubkey: 'accountA', permissions, current: jest.fn(), signer: obtainSigner });
  await expect(signer.crypto('nip44', 'decrypt', 'invalid-peer', 'encrypted payload')).rejects.toThrow('invalid-crypto-request');
  expect(confirm).not.toHaveBeenCalled(); expect(obtainSigner).not.toHaveBeenCalled();
});
