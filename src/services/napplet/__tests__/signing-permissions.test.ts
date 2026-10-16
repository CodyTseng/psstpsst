import { SigningPermissions, type SigningRequest } from '../signing-permissions';
import { getData, setData, type AppScope } from '../repository';
import type { NappletRelease } from '../protocol';

jest.mock('../repository', () => ({ getData: jest.fn(), setData: jest.fn() }));
const stored = new Map<string, string>();
const key = (scope: AppScope, bucket: string, name: string) => JSON.stringify([scope, bucket, name]);
const app = { title: 'App', key: 'app', hash: 'v1' } as NappletRelease;
const request: SigningRequest = {
  operation: 'publish', kind: 30078, relays: ['wss://one.example/'], identifier: 'progress',
  accountPubkey: 'accountA', content: 'private fixture content', tags: [['d', 'progress']], createdAt: 100,
};
function create(confirm = jest.fn(async () => 'allow-always' as string | false), account = 'accountA', version = 'v1') {
  const abort = new AbortController();
  const permissions = new SigningPermissions(
    { accountPubkey: account, appKey: app.key, artifactHash: version }, app, confirm, abort.signal, jest.fn(),
  );
  return { permissions, confirm, abort };
}
beforeEach(() => {
  stored.clear(); jest.clearAllMocks();
  jest.mocked(getData).mockImplementation(async (scope, bucket, name) => stored.get(key(scope, bucket, name)) ?? null);
  jest.mocked(setData).mockImplementation(async (scope, bucket, name, value) => {
    if (value == null) stored.delete(key(scope, bucket, name)); else stored.set(key(scope, bucket, name), value);
  });
});

test('persistent rules are narrow and never cross accounts, artifacts or records', async () => {
  const first = create();
  await first.permissions.authorize(request);
  const reopened = create();
  await reopened.permissions.authorize(request);
  expect(reopened.confirm).not.toHaveBeenCalled();
  const account = create(undefined, 'accountB');
  await account.permissions.authorize({ ...request, accountPubkey: 'accountB' });
  expect(account.confirm).toHaveBeenCalledTimes(1);
  const version = create(undefined, 'accountA', 'v2');
  await version.permissions.authorize(request);
  expect(version.confirm).toHaveBeenCalledTimes(1);
  await first.permissions.authorize({ ...request, identifier: 'other' });
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

test('encrypted publication binds recipient and relay authentication has its own grant', async () => {
  const { permissions, confirm } = create();
  await permissions.authorize({ ...request, operation: 'encrypt-publish', recipient: 'one' });
  await permissions.authorize({ ...request, operation: 'encrypt-publish', recipient: 'two' });
  await permissions.authorize({ ...request, operation: 'relay-auth', kind: 22242 });
  expect(confirm).toHaveBeenCalledTimes(3);
});

test('upload grants are separate from publication and remain bound to storage destinations', async () => {
  const { permissions, confirm } = create();
  const upload = { ...request, operation: 'upload' as const, kind: 24242, identifier: undefined, relays: ['https://storage.example/'] };
  await permissions.authorize(upload);
  await permissions.authorize(upload);
  expect(confirm).toHaveBeenCalledTimes(1);
  await permissions.authorize({ ...upload, relays: ['https://other-storage.example/'] });
  expect(confirm).toHaveBeenCalledTimes(2);
  await permissions.authorize({ ...upload, operation: 'publish' });
  expect(confirm).toHaveBeenCalledTimes(3);
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
  expect(setData).not.toHaveBeenCalled();
});

test('cancelling one upload review cannot persist its late approval or stop the session', async () => {
  let resolve!: (value: string) => void;
  const confirm = jest.fn(() => new Promise<string>((done) => { resolve = done; }));
  const { permissions, abort } = create(confirm);
  const upload = new AbortController();
  const pending = permissions.authorize({ ...request, operation: 'upload', kind: 24242,
    relays: ['https://media.example/'] }, undefined, upload.signal);
  while (!confirm.mock.calls.length) await Promise.resolve();
  upload.abort(); resolve('allow-always');
  await expect(pending).rejects.toThrow();
  expect(setData).not.toHaveBeenCalled();
  expect(abort.signal.aborted).toBe(false);
});

test('a request that expires while being reviewed cannot create a grant', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    const { permissions } = create(jest.fn(async () => { now.mockReturnValue(3000); return 'allow-always'; }));
    await expect(permissions.authorize(request, 2000)).rejects.toThrow('timeout');
    expect(setData).not.toHaveBeenCalled();
  } finally { now.mockRestore(); }
});

test('a failed persistence operation cannot silently activate a remembered grant', async () => {
  const { permissions, confirm } = create();
  jest.mocked(setData).mockRejectedValueOnce(new Error('disk-full'));
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
  await permissions.revoke('any-rule');
  finish('allow-always');
  await expect(authorization).rejects.toThrow('permission-denied');
  expect((await permissions.snapshot()).rules).toEqual([]);
});

test('relay authentication still requires a separate grant for each server', async () => {
  const { permissions, confirm } = create();
  const auth = { ...request, operation: 'relay-auth' as const, kind: 22242 };
  await permissions.authorize(auth);
  await permissions.authorize({ ...auth, relays: ['wss://two.example/'] });
  expect(confirm).toHaveBeenCalledTimes(2);
});

test('old relay-bound publish grants never silently expand to new destinations', async () => {
  const scope = { operation: request.operation, kind: request.kind, relays: request.relays, identifier: request.identifier };
  stored.set(key({ accountPubkey: 'accountA', appKey: app.key, artifactHash: app.hash }, 'permissions', 'signing'), JSON.stringify({
    version: 2, rules: [{ key: JSON.stringify(scope), scope, duration: 'always', decision: 'allow', createdAt: 100 }],
  }));
  const { permissions, confirm } = create();
  await permissions.authorize({ ...request, relays: ['wss://new.example/'] });
  expect(confirm).toHaveBeenCalledTimes(1);
});
