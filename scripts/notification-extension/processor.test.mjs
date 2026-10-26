import { createRequire } from 'node:module';
import { buildVaultObjects } from '../key-vault-native-build.mjs';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomFillSync, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before, after, test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { generateSecretKey, getPublicKey, getEventHash, finalizeEvent, nip44 } from 'nostr-tools';
import { build } from 'esbuild';

import { buildNotificationExtension } from '../build-notification-extension.mjs';

let directory;
let LocalKeyVault;
let processor;
let bootstrap;
let journal;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'psstpsst-notification-test-'));
  await buildNotificationExtension(join(directory, 'processor.js'));
  await build({ entryPoints: ['src/platform/vault/local-vault.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, 'vault.cjs') });
  ({ LocalKeyVault } = createRequire(import.meta.url)(join(directory, 'vault.cjs')));
  processor = await readFile(join(directory, 'processor.js'), 'utf8');
  bootstrap = await readFile(resolve('ios-notification-extension/bootstrap.js'), 'utf8');
  journal = JSON.parse(await readFile(resolve('src/db/migrations/meta/_journal.json'), 'utf8'));
});
after(async () => rm(directory, { recursive: true, force: true }));

test('normalizes relay and Blossom URLs identically through the notification URL bridge', async () => {
  const bundle = await build({
    stdin: {
      contents: "export { normalizeRelayUrl } from './src/lib/nostr/relay-url'; export { normalizeBlossomUrl } from './src/lib/nostr/blossom-url';",
      resolveDir: resolve('.'), loader: 'ts',
    }, bundle: true, write: false,
    format: 'iife', globalName: 'RelayUrls',
  });
  const context = createContext({
    __parseURL: (value, base) => {
      const url = new URL(value, base || undefined);
      return { protocol: url.protocol.toUpperCase(), host: url.host.toUpperCase(), pathname: url.pathname, search: url.search, hash: url.hash };
    },
  });
  runInContext(bootstrap, context);
  runInContext(bundle.outputFiles[0].text, context);
  for (const [input, expected] of [
    ['https://RELAY.example:8443//a///b/?z=hello%20world&a=1#fragment', 'wss://relay.example:8443/a/b?a=1&z=hello+world'],
    ['wss://relay.example:443//?z=2&a=1#fragment', 'wss://relay.example/?a=1&z=2'],
    ['127.0.0.1:80', 'ws://127.0.0.1/'],
    ['wss://relay.example/?token=a/b/', 'wss://relay.example/?token=a%2Fb%2F'],
  ]) {
    assert.equal(context.RelayUrls.normalizeRelayUrl(input), expected);
  }
  for (const [input, expected] of [
    ['HTTPS://MEDIA.example:443', 'https://media.example/'],
    ['https://media.example//api///?z=2&a=1#fragment', 'https://media.example/api?a=1&z=2'],
    ['127.0.0.1:80', 'http://127.0.0.1/'],
  ]) {
    assert.equal(context.RelayUrls.normalizeBlossomUrl(input), expected);
  }
});

function fixture(content = 'private message', { invalidRumorId = false } = {}) {
  const identity = generateSecretKey();
  const encryption = generateSecretKey();
  const sender = generateSecretKey();
  const senderEncryption = generateSecretKey();
  const ephemeral = generateSecretKey();
  const account = getPublicKey(identity);
  const rumor = { pubkey: getPublicKey(sender), kind: 14, content, tags: [['p', account]], created_at: Math.floor(Date.now() / 1000) };
  rumor.id = invalidRumorId ? '0'.repeat(64) : getEventHash(rumor);
  const seal = finalizeEvent({ kind: 13, created_at: rumor.created_at,
    tags: [['n', getPublicKey(senderEncryption)]],
    content: nip44.v2.encrypt(JSON.stringify(rumor), nip44.v2.utils.getConversationKey(senderEncryption, getPublicKey(encryption))),
  }, sender);
  const event = finalizeEvent({ kind: 1059, created_at: rumor.created_at, tags: [['p', account]],
    content: nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(ephemeral, getPublicKey(encryption))),
  }, ephemeral);
  return { account, rumor, event, seal, recipientEncryptionPubkey: getPublicKey(encryption), keys: new Map([
    [`encryption_keys_${account}`, JSON.stringify([{ privkey: Buffer.from(encryption).toString('hex'), createdAt: rumor.created_at }])],
    [`identity_privkey_${account}`, Buffer.from(identity).toString('hex')],
  ]) };
}

async function database(input, { enabled = true, accepted = true, muted = false, blocked = false, dnd = false, preview = false } = {}, location = ':memory:') {
  const sqlite = new DatabaseSync(location);
  for (const entry of journal.entries) {
    const sql = await readFile(resolve(`src/db/migrations/${entry.tag}.sql`), 'utf8');
    sqlite.exec(sql);
  }
  sqlite.prepare('INSERT INTO accounts (pubkey, signer_type, added_at) VALUES (?, ?, ?)').run(input.account, 'generated', 1);
  sqlite.prepare('INSERT INTO device_preferences (key, value, updated_at) VALUES (?, ?, ?)').run('notifications.enabled', enabled ? '1' : '0', 1);
  // The UI points to a different account; extension intake must ignore it.
  sqlite.prepare('INSERT INTO device_preferences (key, value, updated_at) VALUES (?, ?, ?)').run('active_account_pubkey', 'f'.repeat(64), 1);
  if (dnd) {
    const minute = new Date().getHours() * 60 + new Date().getMinutes();
    sqlite.prepare('INSERT INTO device_preferences (key, value, updated_at) VALUES (?, ?, ?)').run('notifications.dndWindow', JSON.stringify({ enabled: true, startMinutes: minute, endMinutes: (minute + 1) % 1440 }), 1);
  }
  if (preview) sqlite.prepare('INSERT INTO device_preferences (key, value, updated_at) VALUES (?, ?, ?)').run('notifications.contentPreferences', JSON.stringify({ showMessageContent: true }), 1);
  sqlite.prepare(`INSERT INTO conversations (account_pubkey, conversation_key, created_at, created_order_at, updated_at, updated_order_at, has_replied, muted) VALUES (?, ?, 1, 1000, 1, 1000, ?, ?)`)
    .run(input.account, input.rumor.pubkey, Number(accepted), Number(muted));
  if (blocked) sqlite.prepare('INSERT INTO blocked_users (account_pubkey, pubkey, blocked_at) VALUES (?, ?, 1)').run(input.account, input.rumor.pubkey);
  return sqlite;
}

async function receive(sqlite, input, payload, { present = false, http } = {}) {
  const vault = new LocalKeyVault({ getItem: async key => input.keys.get(key) ?? null,
    setItem: async (key, value) => { input.keys.set(key, value); }, deleteItem: async key => { input.keys.delete(key); } });
  const timers = new Set();
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const context = createContext({
    __locale: 'en', __deadlineTime: Date.now() + 24000,
    __receiveContext: { userPresent: present, activeConversation: null },
    __complete: (value) => finish(JSON.parse(value)),
    __encodeUTF8: (value) => [...Buffer.from(value, 'utf8')],
    __decodeUTF8: (value) => Buffer.from(value).toString('utf8'),
    __randomBytes: (count) => [...randomFillSync(Buffer.alloc(count))],
    __base64Encode: (value) => Buffer.from(value, 'latin1').toString('base64'),
    __base64Decode: (value) => Buffer.from(value, 'base64').toString('latin1'),
    __parseURL: (value, base) => {
      const url = new URL(value, base || undefined);
      return { protocol: url.protocol, host: url.host, pathname: url.pathname, search: url.search, hash: url.hash };
    },
    __setTimer: (callback, delay) => { const id = setTimeout(callback, delay); timers.add(id); return id; },
    __clearTimer: (id) => { clearTimeout(id); timers.delete(id); },
    __openSocket: () => { throw new Error('Unexpected relay connection'); },
    __fetch: (url, method, headers, body, callback) => {
      if (!http) throw new Error('Unexpected HTTP request');
      queueMicrotask(() => callback(null, http(url, method, headers, body)));
      return 1;
    },
    __cancelFetch() {},
    __nativeCall: (method, args, callback) => queueMicrotask(async () => {
      try {
        let value = null;
        if (method === 'vault') value = JSON.stringify(await vault.execute(JSON.parse(args[0])));
        else if (method === 'keySet') input.keys.set(args[0], args[1]);
        else if (method === 'keyDelete') input.keys.delete(args[0]);
        else if (method === 'sha256') value = createHash('sha256').update(Buffer.from(args[0])).digest('hex');
        else if (method === 'exec') sqlite.exec(args[0]);
        else if (method === 'sql' || method === 'query') {
          const statement = sqlite.prepare(args[0]);
          if (method === 'sql') statement.setReturnArrays(true);
          const rows = args[2] === 'run' ? (statement.run(...args[1]), []) : statement.all(...args[1]);
          value = method === 'query' ? rows : { rows: args[2] === 'get' ? rows[0] ?? null : rows };
        } else throw new Error(`Unexpected native call: ${method}`);
        callback(null, value);
      } catch (error) { callback(error.message, null); }
    }),
  });
  try {
    runInContext(bootstrap, context);
    runInContext(processor, context);
    context.PsstPsstNotification.receive(JSON.stringify(payload));
    return await Promise.race([completed, new Promise((_, reject) => {
      const id = setTimeout(() => reject(new Error('Processor deadline exceeded')), 5000);
      timers.add(id);
    })]);
  } finally { for (const timer of timers) clearTimeout(timer); }
}

test('independent runtime verifies, decrypts and stores for an inactive account, once', async () => {
  const input = fixture();
  const sqlite = await database(input);
  try {
    const result = await receive(sqlite, input, { type: 'event', data: input.event });
    assert.equal(result.status, 'notify');
    assert.equal(result.accountPubkey, input.account);
    assert.equal(result.rumorId, input.rumor.id);
    assert.ok(!result.body.includes(input.rumor.content));
    assert.equal(result.communication, undefined);
    assert.equal(result.avatarUrl, undefined);
    const row = sqlite.prepare('SELECT * FROM messages').get();
    assert.equal(row.account_pubkey, input.account);
    assert.equal(row.content, input.rumor.content);
    assert.deepEqual(JSON.parse(row.source_relays), ['wss://relay.psstpsst.chat/']);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM processed_gift_wraps').get().n, 1);
    assert.equal((await receive(sqlite, input, { type: 'id', data: { id: input.event.id, p: input.account } })).status, 'suppress');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
  } finally { sqlite.close(); }
});

test('notification intake receives only current metadata while the vault decrypts a retained historical key', async () => {
  const input = fixture();
  const name = `encryption_keys_${input.account}`;
  const retained = JSON.parse(input.keys.get(name));
  input.keys.set(name, JSON.stringify([{ privkey: Buffer.from(generateSecretKey()).toString('hex'), createdAt: input.rumor.created_at + 1 }, ...retained]));
  const sqlite = await database(input);
  try {
    const result = await receive(sqlite, input, { type: 'event', data: input.event });
    assert.equal(result.status, 'notify');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  } finally { sqlite.close(); }
});

test('ID delivery uses fixed authenticated HTTP before the same receiver', async () => {
  const input = fixture();
  const sqlite = await database(input, { preview: true });
  let requests = 0;
  try {
    const result = await receive(sqlite, input, { type: 'id', data: { id: input.event.id, p: input.account } }, {
      http(url, method, headers, body) {
        requests++;
        assert.equal(url, `https://relay.psstpsst.chat/v1/events/${input.event.id}`);
        assert.equal(method, 'GET');
        assert.equal(body, null);
        const auth = JSON.parse(Buffer.from(headers.Authorization.slice(6), 'base64').toString('utf8'));
        assert.equal(auth.pubkey, input.account);
        assert.equal(auth.kind, 27235);
        assert.deepEqual(auth.tags, [['u', url], ['method', 'GET']]);
        return { status: 200, body: JSON.stringify(input.event) };
      },
    });
    assert.equal(result.status, 'notify');
    assert.equal(result.body, input.rumor.content);
    assert.equal(requests, 1);
  } finally { sqlite.close(); }
});

for (const options of [{ enabled: false }, { muted: true }, { accepted: false }, { dnd: true }]) {
  test(`notification policy suppresses after persistence: ${JSON.stringify(options)}`, async () => {
    const input = fixture();
    const sqlite = await database(input, options);
    try {
      assert.equal((await receive(sqlite, input, { type: 'event', data: input.event })).status, 'suppress');
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
    } finally { sqlite.close(); }
  });
}

test('blocked and tampered events never enter message history', async () => {
  for (const blocked of [false, true]) {
    const input = fixture();
    const sqlite = await database(input, { blocked });
    try {
      const event = blocked ? input.event : { ...input.event, content: input.event.content + 'x' };
      assert.equal((await receive(sqlite, input, { type: 'event', data: event })).status, 'suppress');
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
      if (!blocked) assert.equal(sqlite.prepare('SELECT count(*) AS n FROM processed_gift_wraps').get().n, 0);
    } finally { sqlite.close(); }
  }
});

test('missing keys remain retryable once secure storage becomes available', async () => {
  const input = fixture();
  const sqlite = await database(input);
  const key = `encryption_keys_${input.account}`;
  const saved = input.keys.get(key);
  input.keys.delete(key);
  try {
    assert.equal((await receive(sqlite, input, { type: 'event', data: input.event })).status, 'suppress');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM processed_gift_wraps').get().n, 0);
    input.keys.set(key, saved);
    assert.equal((await receive(sqlite, input, { type: 'event', data: input.event })).status, 'notify');
  } finally { sqlite.close(); }
});


test('native presence lock releases for suspension, recovers from contention and cancels stale retries', { skip: process.platform !== 'darwin' }, () => {
  const executable = join(directory, 'presence-lock-harness');
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(directory, 'swift-cache'),
    'modules/expo-local-notifications/ios/SharedNotificationContext.swift',
    'scripts/notification-extension/PresenceLockHarness.swift', '-o', executable,
  ], { timeout: 60000, stdio: 'pipe' });
  assert.equal(execFileSync(executable, [join(directory, 'app-presence.lock')], {
    timeout: 25000, encoding: 'utf8',
  }).trim(), 'ok');
});

test('shipping Swift bridge executes the same processor in JavaScriptCore', { skip: process.platform !== 'darwin' }, async () => {
  const executable = join(directory, 'runtime-harness');
  const vaultObjects = buildVaultObjects(directory);
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(directory, 'swift-cache'),
    '-framework', 'JavaScriptCore', '-framework', 'Security', '-lsqlite3',
    '-import-objc-header', 'modules/expo-crypto-accelerator/ios/ExpoCryptoAcceleratorSecp256k1.h',
    'modules/expo-crypto-accelerator/ios/NativeKeyVault.swift', ...vaultObjects,
    'ios-notification-extension/NotificationRuntime.swift',
    'modules/expo-local-notifications/ios/SharedNotificationContext.swift',
    'scripts/notification-extension/RuntimeHarness.swift', '-o', executable,
  ], { timeout: 60000, stdio: 'pipe' });
  const nativeDirectory = join(directory, 'native');
  await mkdir(nativeDirectory);
  await writeFile(join(nativeDirectory, 'processor.js'), processor);
  await writeFile(join(nativeDirectory, 'bootstrap.js'), bootstrap);
  const input = fixture();
  const sqlite = await database(input, {}, join(nativeDirectory, 'psstpsst.db'));
  const version = journal.entries.at(-1).when;
  sqlite.exec(`CREATE TABLE __drizzle_migrations (created_at INTEGER); INSERT INTO __drizzle_migrations VALUES (${version});`);
  try {
    await writeFile(join(nativeDirectory, 'fixture.json'), JSON.stringify({
      keys: Object.fromEntries(input.keys), schemaVersion: version,
      payload: { type: 'event', data: input.event },
    }));
    const result = JSON.parse(execFileSync(executable, [nativeDirectory], { timeout: 25000, encoding: 'utf8' }));
    assert.equal(result.status, 'notify');
    assert.equal(result.rumorId, input.rumor.id);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
    const duplicate = JSON.parse(execFileSync(executable, [nativeDirectory], { timeout: 25000, encoding: 'utf8' }));
    assert.equal(duplicate.status, 'suppress');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
  } finally { sqlite.close(); }
});


test('a separately wrapped copy of the same rumor does not alert twice', async () => {
  const input = fixture();
  const sqlite = await database(input);
  try {
    assert.equal((await receive(sqlite, input, { type: 'event', data: input.event })).status, 'notify');
    const ephemeral = generateSecretKey();
    const second = finalizeEvent({ kind: 1059, created_at: input.event.created_at, tags: input.event.tags,
      content: nip44.v2.encrypt(JSON.stringify(input.seal), nip44.v2.utils.getConversationKey(ephemeral, input.recipientEncryptionPubkey)),
    }, ephemeral);
    assert.notEqual(second.id, input.event.id);
    assert.equal((await receive(sqlite, input, { type: 'event', data: second })).status, 'suppress');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM processed_gift_wraps').get().n, 2);
  } finally { sqlite.close(); }
});

test('an authenticated seal cannot substitute a noncanonical rumor ID', async () => {
  const input = fixture('private message', { invalidRumorId: true });
  const sqlite = await database(input);
  try {
    assert.equal((await receive(sqlite, input, { type: 'event', data: input.event })).status, 'suppress');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM processed_gift_wraps').get().n, 0);
  } finally { sqlite.close(); }
});

test('an independent receiver cannot recreate an account during removal', async () => {
  const input = fixture();
  const sqlite = await database(input);
  sqlite.prepare('INSERT INTO device_preferences (key, value, updated_at) VALUES (?, ?, 1)').run(`account.removing.${input.account}`, '1');
  try {
    assert.equal((await receive(sqlite, input, { type: 'event', data: input.event })).status, 'suppress');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM processed_gift_wraps').get().n, 0);
  } finally { sqlite.close(); }
});


test('sender opt-in supplies communication identity and avatar without exposing message text', async () => {
  const input = fixture();
  const sqlite = await database(input);
  try {
    sqlite.prepare('INSERT INTO device_preferences (key, value, updated_at) VALUES (?, ?, ?)')
      .run('notifications.contentPreferences', JSON.stringify({ showSender: true, showMessageContent: false }), 1);
    sqlite.prepare('INSERT INTO profiles (pubkey, display_name, picture, fetched_at) VALUES (?, ?, ?, ?)')
      .run(input.rumor.pubkey, 'Alice', 'https://images.example/alice.png', 1);
    const result = await receive(sqlite, input, { type: 'event', data: input.event });
    assert.equal(result.status, 'notify');
    assert.equal(result.title, 'Alice');
    assert.equal(result.avatarUrl, 'https://images.example/alice.png');
    assert.equal(result.communication.senderId, input.rumor.pubkey);
    assert.equal(result.communication.senderName, 'Alice');
    assert.equal(result.communication.recipientId, input.account);
    assert.equal(result.communication.conversationId, `${input.account}:${input.rumor.pubkey}`);
    assert.ok(!result.body.includes(input.rumor.content));
  } finally { sqlite.close(); }
});
