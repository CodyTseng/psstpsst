import { LocalWalletVault } from './local-wallet-vault';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { createNostrConnectURI } from 'nostr-tools/nip46';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, verifyEvent } from 'nostr-tools';
import * as nip04 from 'nostr-tools/nip04';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import type { VaultCommand, VaultKey, MessagingKey, MessagingDecryption, PairedBunker } from '../ports/key-vault';
import { isVaultMethod } from '../ports/key-vault';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};
type StoredKey = { privkey: string; createdAt: number | null };
const identity = (account: string) => `identity_privkey_${account}`;
const client = (account: string) => `nip46_client_privkey_${account}`;
const secret = (account: string) => `nip46_bunker_secret_${account}`;
const binding = (account: string) => `nip46_bunker_binding_${account}`;
const messaging = (account: string) => `encryption_keys_${account}`;
const validHex = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);

/** Trusted worker implementation. Never import this module into a renderer. */
export class LocalKeyVault {
  private pairings = new Map<string, { bytes: Uint8Array; pubkey: string; peer: string | null; secret: string | null; relays: string[]; connected: boolean;
    account?: string; pending?: { id: string; operation: 'connect' | 'get_public_key' }; committed?: PairedBunker }>();
  private keyCache = new Map<string, string>();
  private publicCache = new Map<string, string>();
  private ephemeral = new Map<string, { hex: string; purpose: 'account' | 'key-sync' }>();
  private queue: Promise<unknown> = Promise.resolve();
  private conversations = new Map<string, Uint8Array>();
  private wallet: LocalWalletVault;
  constructor(private storage: Storage) { this.wallet = new LocalWalletVault(storage); }

  walletInternal(action: string, account: string, value?: unknown): Promise<unknown> {
    return this.serialized(async () => {
      if (!validHex(account)) throw new Error('Invalid account');
      switch (action) {
        case 'hasPin': return this.wallet.hasPin(account);
        case 'setPin': return this.wallet.setPin(account, value as string);
        case 'verifyPin': return this.wallet.verifyPin(account, value as string);
        case 'bound': return this.wallet.bound(account, value as string);
        case 'details': return this.wallet.paymentDetails(value as Parameters<LocalWalletVault['paymentDetails']>[0]);
        case 'trusted': return this.wallet.execute(value as import('../ports/key-vault').WalletVaultCommand, true);
        default: throw new Error('Invalid private wallet operation');
      }
    });
  }

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  execute(command: VaultCommand): Promise<unknown> {
    return this.serialized(() => this.run(command));
  }

  /** Private host channel used by trusted credential input, not generic dispatch. */
  importIdentity(nsec: string): Promise<{ pubkey: string }> {
    return this.serialized(async () => {
      const decoded = nip19.decode(nsec);
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
      try {
        const pubkey = getPublicKey(decoded.data);
        await this.storage.setItem(identity(pubkey), bytesToHex(decoded.data));
        this.clearCache(pubkey);
        return { pubkey };
      } finally { decoded.data.fill(0); }
    });
  }

  private async readKeys(account: string): Promise<StoredKey[]> {
    const raw = this.keyCache.get(`list:${account}`) ?? await this.storage.getItem(messaging(account));
    if (raw) this.keyCache.set(`list:${account}`, raw);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) throw new Error('Invalid messaging key storage');
    const now = Math.floor(Date.now() / 1000);
    const keys = values.flatMap((value, index): StoredKey[] => {
      if (validHex(value)) return [{ privkey: value.toLowerCase(), createdAt: index === 0 ? now : null }];
      if (!value || !validHex(value.privkey)) throw new Error('Invalid messaging key storage');
      return [{ privkey: value.privkey.toLowerCase(), createdAt: Number.isSafeInteger(value.createdAt) && value.createdAt > 0 ? value.createdAt : index === 0 ? now : null }];
    });
    const normalized = JSON.stringify(keys);
    if (normalized !== raw) {
      await this.storage.setItem(messaging(account), normalized);
      this.keyCache.set(`list:${account}`, normalized);
    }
    return keys;
  }

  private metadata(account: string, stored: StoredKey): MessagingKey {
    const bytes = hexToBytes(stored.privkey);
    try {
      const pubkey = this.publicCache.get(stored.privkey) ?? getPublicKey(bytes);
      if (this.publicCache.size >= 128) this.publicCache.clear();
      this.publicCache.set(stored.privkey, pubkey);
      return { pubkey, createdAt: stored.createdAt ?? 0, key: { account, role: 'messaging', pubkey } };
    } finally { bytes.fill(0); }
  }

  private async decryptMessaging(account: string, event: import('nostr-tools').Event): Promise<MessagingDecryption> {
    // Storage errors must remain distinguishable from an unreadable network event.
    const keys = await this.readKeys(account);
    try { if (event.kind !== 1059 || !verifyEvent(event)) return { status: 'failed' }; }
    catch { return { status: 'failed' }; }
    for (const stored of keys) {
      const ref = this.metadata(account, stored).key;
      const bytes = hexToBytes(stored.privkey);
      try {
        const outerKey = nip44.v2.utils.getConversationKey(bytes, event.pubkey);
        let seal: import('nostr-tools').Event;
        try { seal = JSON.parse(nip44.v2.decrypt(event.content, outerKey)); }
        finally { outerKey.fill(0); }
        if (seal.kind !== 13 || !verifyEvent(seal)) continue;
        const tag = seal.tags.find(tag => tag[0] === 'n');
        if (!tag) return { status: 'unsupported', reason: 'missing-encryption-key-tag' };
        if (!validHex(tag[1])) continue;
        const rumorJson = nip44.v2.decrypt(seal.content, this.conversation(ref, bytes, tag[1]));
        return { status: 'decrypted', seal, rumorJson, senderEncryptionPubkey: tag[1] };
      } catch { /* Try the next retained key for malformed or unrelated ciphertext. */ }
      finally { bytes.fill(0); }
    }
    return { status: 'failed' };
  }

  private async add(account: string, hex: string, createdAt: number): Promise<MessagingKey> {
    if (!validHex(hex)) throw new Error('Invalid private key');
    const bytes = hexToBytes(hex);
    try { getPublicKey(bytes); } finally { bytes.fill(0); }
    const keys = await this.readKeys(account);
    hex = hex.toLowerCase();
    const existing = keys.find(key => key.privkey === hex);
    const added = { privkey: hex, createdAt: existing?.createdAt ?? createdAt };
    await this.storage.setItem(messaging(account), JSON.stringify([added, ...keys.filter(key => key.privkey !== hex)].slice(0, 10)));
    this.clearCache(account);
    return this.metadata(account, added);
  }

  private async withKey<T>(key: VaultKey, run: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
    if (!key || !validHex(key.account)) throw new Error('Invalid account key');
    const cacheId = JSON.stringify(key);
    let hex: string | null | undefined = this.keyCache.get(cacheId);
    if (!hex) {
      if (key.role === 'ephemeral') {
        const entry = this.ephemeral.get(key.account);
        if (entry) hex = entry.hex;
      }
      else if (key.role === 'proximity') hex = await this.storage.getItem(`proximity_identity_privkey_${key.account}`);
      else if (key.role === 'identity') hex = await this.storage.getItem(identity(key.account));
      else if (key.role === 'nip46-client') hex = await this.storage.getItem(client(key.account));
      else if (key.role === 'messaging') {
        const keys = await this.readKeys(key.account);
        hex = keys.find(stored => this.metadata(key.account, stored).pubkey === key.pubkey)?.privkey;
      } else throw new Error('Invalid key role');
    }
    if (!validHex(hex)) throw new Error('Key not found');
    if (key.role === 'identity' && !this.keyCache.has(cacheId)) {
      const bytes = hexToBytes(hex);
      try { if (getPublicKey(bytes) !== key.account) throw new Error('Account key mismatch'); } finally { bytes.fill(0); }
    }
    if (key.role !== 'ephemeral') this.keyCache.set(cacheId, hex);
    const bytes = hexToBytes(hex);
    try {
      if (key.role === 'proximity' && key.pubkey !== undefined && getPublicKey(bytes) !== key.pubkey) throw new Error('Nearby identity changed');
      return await run(bytes);
    } finally { bytes.fill(0); }
  }

  private clearCache(account: string): void {
    this.keyCache.clear(); this.publicCache.clear();
    for (const [id, key] of this.conversations) {
      if (id.startsWith(`${account}:`)) { key.fill(0); this.conversations.delete(id); }
    }
  }

  private conversation(key: VaultKey, bytes: Uint8Array, peer: string): Uint8Array {
    const id = `${key.account}:${key.role}:${key.pubkey ?? ''}:${peer}`;
    let value = this.conversations.get(id);
    if (!value) {
      value = nip44.v2.utils.getConversationKey(bytes, peer);
      if (this.conversations.size >= 256) {
        const oldest = this.conversations.keys().next().value!;
        this.conversations.get(oldest)!.fill(0);
        this.conversations.delete(oldest);
      }
      this.conversations.set(id, value);
    }
    return value;
  }

  async isBunkerBound(account: string, peer: string): Promise<boolean> {
    return this.serialized(async () => await this.storage.getItem(binding(account)) === peer);
  }
  /** Called only through the private host channel after native confirmation. */
  async bindBunker(account: string, peer: string): Promise<void> {
    return this.serialized(async () => {
      if (!validHex(account) || !validHex(peer)) throw new Error('Invalid bunker binding');
      const existing = await this.storage.getItem(binding(account));
      if (existing && existing !== peer) throw new Error('Bunker binding mismatch');
      await this.storage.setItem(binding(account), peer);
    });
  }

  /** Private host helper used only after trusted backup confirmation. */
  async identityBackup(account: string): Promise<string | null> {
    const temporary = this.ephemeral.get(account);
    const hex = await this.storage.getItem(identity(account)) ?? (temporary && temporary.purpose === 'account' ? temporary.hex : null);
    if (!hex) return null;
    const bytes = hexToBytes(hex);
    try { return nip19.nsecEncode(bytes); } finally { bytes.fill(0); }
  }


  private async pairing(command: Extract<VaultCommand, { session: string }> | Extract<VaultCommand, { method: 'beginBunkerPairing' }>): Promise<unknown> {
    if (command.method === 'beginBunkerPairing') {
      if (this.pairings.size >= 8 || !Array.isArray(command.relays) || !command.relays.length || command.relays.some(value => typeof value !== 'string')) throw new Error('Invalid pairing');
      if (command.peer !== null && !validHex(command.peer)) throw new Error('Invalid bunker peer');
      if (command.secret !== null && typeof command.secret !== 'string') throw new Error('Invalid pairing secret');
      const bytes = generateSecretKey();
      const session = bytesToHex(generateSecretKey());
      const pubkey = getPublicKey(bytes);
      const nonce = command.peer === null ? bytesToHex(generateSecretKey()) : command.secret;
      this.pairings.set(session, { bytes, pubkey, peer: command.peer, secret: nonce, relays: [...command.relays], connected: false });
      const uri = command.peer === null ? createNostrConnectURI({ clientPubkey: pubkey, relays: command.relays, secret: nonce!, name: 'PsstPsst' }) : null;
      return { session, clientPubkey: pubkey, uri };
    }
    const pair = this.pairings.get(command.session);
    if (!pair) throw new Error('Pairing session ended');
    if (command.method === 'cancelBunkerPairing') {
      pair.bytes.fill(0); this.pairings.delete(command.session); return null;
    }
    if (pair.committed && command.method !== 'commitBunkerPairing') throw new Error('Pairing is complete');
    if (command.method === 'bunkerPairingRequest') {
      if (!pair.peer || (command.operation !== 'connect' && command.operation !== 'get_public_key') || (command.operation === 'get_public_key' && !pair.connected)) throw new Error('Invalid pairing operation');
      const id = bytesToHex(generateSecretKey());
      pair.pending = { id, operation: command.operation };
      const conversation = nip44.v2.utils.getConversationKey(pair.bytes, pair.peer);
      try {
        const params = command.operation === 'connect' ? [pair.peer, pair.secret ?? ''] : [];
        return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', pair.peer]],
          content: nip44.v2.encrypt(JSON.stringify({ id, method: command.operation, params }), conversation) }, pair.bytes);
      } finally { conversation.fill(0); }
    }
    if (command.method === 'bunkerPairingReceive') {
      const event = command.event;
      if (!verifyEvent(event) || event.kind !== 24133 || !event.tags.some(tag => tag[0] === 'p' && tag[1] === pair.pubkey) || (pair.peer && event.pubkey !== pair.peer)) return { type: 'ignored' };
      let response;
      const conversation = nip44.v2.utils.getConversationKey(pair.bytes, event.pubkey);
      try { response = JSON.parse(nip44.v2.decrypt(event.content, conversation)); } catch { return { type: 'ignored' }; }
      finally { conversation.fill(0); }
      if (!response || typeof response !== 'object' || 'method' in response || 'params' in response) return { type: 'ignored' };
      if (!pair.peer) {
        if (response.result !== pair.secret) return { type: 'ignored' };
        pair.peer = event.pubkey; return { type: 'peer', peer: pair.peer };
      }
      if (!pair.pending || response.id !== pair.pending.id) return { type: 'ignored' };
      if (response.result === 'auth_url' && typeof response.error === 'string') return { type: 'auth', url: response.error };
      if (response.error || typeof response.result !== 'string') return { type: 'rejected' };
      const operation = pair.pending.operation;
      pair.pending = undefined;
      if (operation === 'connect') { pair.connected = true; return { type: 'connected' }; }
      if (!validHex(response.result)) throw new Error('Invalid bunker identity');
      pair.account = response.result;
      return { type: 'account', pubkey: pair.account };
    }
    if (command.method === 'commitBunkerPairing') {
      if (!pair.connected || !pair.account || !pair.peer) throw new Error('Pairing is incomplete');
      if (!pair.committed) {
        const existing = await this.storage.getItem(client(pair.account));
        if (existing === null) {
          // Write only this session's supplied credential, with the client key last.
          // A partial write cannot cause a new client to reuse an old secret.
          await this.storage.deleteItem(secret(pair.account));
          await this.storage.deleteItem(binding(pair.account));
          if (pair.secret !== null) await this.storage.setItem(secret(pair.account), pair.secret);
          await this.storage.setItem(binding(pair.account), pair.peer);
          await this.storage.setItem(client(pair.account), bytesToHex(pair.bytes));
          this.clearCache(pair.account);
        }
        pair.committed = { pubkey: pair.account, pointer: { pubkey: pair.peer, relays: pair.relays, secret: null }, existing: existing !== null };
        pair.bytes.fill(0);
      }
      return pair.committed;
    }
    throw new Error('Invalid pairing command');
  }

  private async run(command: VaultCommand): Promise<unknown> {
    if (!command || typeof command !== 'object' || Array.isArray(command) || !isVaultMethod(command.method)) throw new Error('Invalid vault command');
    if (command.method.startsWith('wallet')) return this.wallet.execute(command as import('../ports/key-vault').WalletVaultCommand);
    if ('account' in command && !validHex(command.account)) throw new Error('Invalid account');
    if (command.method === 'beginBunkerPairing' || command.method === 'bunkerPairingRequest' || command.method === 'bunkerPairingReceive' || command.method === 'commitBunkerPairing' || command.method === 'cancelBunkerPairing') return this.pairing(command);
    switch (command.method) {
      case 'migrateStorage':
        if (!Array.isArray(command.accounts) || !Array.isArray(command.wallets)) throw new Error('Invalid storage migration');
        for (const account of command.accounts) {
          if (!validHex(account)) throw new Error('Invalid migration account');
          await this.readKeys(account);
        }
        for (const bunker of command.bunkers ?? []) {
          if (!validHex(bunker.account) || !validHex(bunker.peer)) throw new Error('Invalid bunker migration');
          const existing = await this.storage.getItem(binding(bunker.account));
          if (existing && existing !== bunker.peer) throw new Error('Bunker binding mismatch');
          if (!existing) await this.storage.setItem(binding(bunker.account), bunker.peer);
        }
        for (const wallet of command.wallets) await this.wallet.migrateLegacy(wallet);
        return null;
      case 'ensureProximity': {
        const name = `proximity_identity_privkey_${command.account}`;
        let value = await this.storage.getItem(name);
        if (value === null) {
          const bytes = generateSecretKey();
          try { value = bytesToHex(bytes); await this.storage.setItem(name, value); } finally { bytes.fill(0); }
        }
        const key: VaultKey = { account: command.account, role: 'proximity' };
        return { pubkey: await this.withKey(key, bytes => getPublicKey(bytes)), key };
      }
      case 'removeProximity':
        this.clearCache(command.account);
        await this.storage.deleteItem(`proximity_identity_privkey_${command.account}`); return null;
      case 'bindProximityNoise':
        if (!validHex(command.noisePubkey)) throw new Error('Invalid Noise public key');
        return this.withKey({ account: command.account, role: 'proximity' }, bytes => {
          const label = new TextEncoder().encode('PsstPsst Nearby Noise Binding/1');
          const message = new Uint8Array(label.length + 64);
          message.set(label); message.set(schnorr.getPublicKey(bytes), label.length); message.set(hexToBytes(command.noisePubkey), label.length + 32);
          return bytesToHex(schnorr.sign(sha256(message), bytes));
        });
      case 'generateEphemeral': {
        if (command.purpose !== 'account' && command.purpose !== 'key-sync') throw new Error('Invalid temporary key purpose');
        if (this.ephemeral.size >= 64) throw new Error('Too many key sessions');
        const bytes = generateSecretKey();
        try {
          const pubkey = getPublicKey(bytes);
          this.ephemeral.set(pubkey, { hex: bytesToHex(bytes), purpose: command.purpose });
          return { pubkey, createdAt: Math.floor(Date.now() / 1000), key: { account: pubkey, role: 'ephemeral' } };
        } finally { bytes.fill(0); }
      }
      case 'endSession': this.clearCache(command.account); return null;
      case 'releaseEphemeral': this.ephemeral.delete(command.account); this.clearCache(command.account); return null;
      case 'persistIdentity': {
        const entry = this.ephemeral.get(command.account);
        if (entry && entry.purpose !== 'account') throw new Error('Key session ended');
        if (!entry) {
          const saved = await this.storage.getItem(identity(command.account));
          if (!validHex(saved)) throw new Error('Key session ended');
          const bytes = hexToBytes(saved);
          try { if (getPublicKey(bytes) !== command.account) throw new Error('Account key mismatch'); } finally { bytes.fill(0); }
          return null;
        }
        await this.storage.setItem(identity(command.account), entry.hex);
        this.ephemeral.delete(command.account); return null;
      }
      case 'migrateBunkerSecret': {
        if (!validHex(command.peer) || (command.secret !== null && typeof command.secret !== 'string')) throw new Error('Invalid bunker migration');
        // Existing credentials are immutable. Legacy DB material can fill only an empty slot.
        if (await this.storage.getItem(secret(command.account)) !== null) return null;
        const peer = await this.storage.getItem(binding(command.account));
        if (peer && peer !== command.peer) throw new Error('Bunker binding mismatch');
        if (command.secret !== null) {
          await this.storage.setItem(secret(command.account), command.secret);
          await this.storage.setItem(binding(command.account), command.peer);
        }
        return null;
      }
      case 'removeBunker':
        this.clearCache(command.account);
        await this.storage.deleteItem(client(command.account));
        await this.storage.deleteItem(secret(command.account));
        await this.storage.deleteItem(binding(command.account));
        return null;
      case 'removeIdentity': case 'removeMessaging':
        this.clearCache(command.account);
        await this.storage.deleteItem(command.method === 'removeIdentity' ? identity(command.account) : messaging(command.account));
        return null;
      case 'publicKey': return this.withKey(command.key, bytes => getPublicKey(bytes));
      case 'signEvent':
        if (command.key.role !== 'identity' && command.key.role !== 'proximity') throw new Error('Restricted signing key');
        return this.withKey(command.key, bytes => finalizeEvent(command.template, bytes));
      case 'crypto':
        if (command.key.role === 'ephemeral') throw new Error('Temporary keys require their dedicated operation');
        if (command.key.role === 'messaging' && command.operation === 'decrypt') throw new Error('Messaging keys require dedicated decryption');
        return this.withKey(command.key, async bytes => {
        if (command.key.role === 'nip46-client' && (command.algorithm !== 'nip44' || command.operation !== 'decrypt')) throw new Error('Restricted client operation');
        if (!validHex(command.peer) || typeof command.text !== 'string') throw new Error('Invalid crypto request');
        if (command.algorithm === 'nip44') {
          const key = command.cache === false ? nip44.v2.utils.getConversationKey(bytes, command.peer) : this.conversation(command.key, bytes, command.peer);
          try {
          if (command.operation === 'encrypt') return nip44.v2.encrypt(command.text, key);
          if (command.operation === 'decrypt') {
            const result = nip44.v2.decrypt(command.text, key);
            if (command.key.role === 'nip46-client') {
              const response = JSON.parse(result);
              if (!response || typeof response !== 'object' || 'method' in response || 'params' in response ||
                typeof response.id !== 'string' || (typeof response.result !== 'string' && typeof response.error !== 'string'))
                throw new Error('Invalid bunker response');
            }
            return result;
          }
          } finally { if (command.cache === false) key.fill(0); }
        } else if (command.algorithm === 'nip04') {
          if (command.operation === 'encrypt') return nip04.encrypt(bytes, command.peer, command.text);
          if (command.operation === 'decrypt') return nip04.decrypt(bytes, command.peer, command.text);
        }
        throw new Error('Invalid crypto operation');
      });
      case 'decryptMessaging': return this.decryptMessaging(command.account, command.event);
      case 'getCurrentMessagingKey': {
        const current = (await this.readKeys(command.account))[0];
        return current ? this.metadata(command.account, current) : null;
      }
      case 'hasMessagingKey':
        return validHex(command.pubkey) && (await this.readKeys(command.account))
          .some(key => this.metadata(command.account, key).pubkey === command.pubkey.toLowerCase());
      case 'generateMessaging': {
        const bytes = generateSecretKey();
        try { return await this.add(command.account, bytesToHex(bytes), Math.floor(Date.now() / 1000)); } finally { bytes.fill(0); }
      }
      case 'exportTransfer': {
        const keys = await this.readKeys(command.account);
        const selected = command.pubkey ? keys.find(key => this.metadata(command.account, key).pubkey === command.pubkey) : keys[0];
        if (!selected) throw new Error('Messaging key not found');
        const ephemeral = generateSecretKey();
        let conversation: Uint8Array | undefined;
        try {
          conversation = nip44.v2.utils.getConversationKey(ephemeral, command.recipient);
          return { senderPubkey: getPublicKey(ephemeral), content: nip44.v2.encrypt(selected.privkey, conversation) };
        } finally { ephemeral.fill(0); conversation?.fill(0); }
      }
      case 'importTransfer': {
        if (command.client.role !== 'ephemeral' || this.ephemeral.get(command.client.account)?.purpose !== 'key-sync') throw new Error('Invalid transfer session');
        return this.withKey(command.client, async bytes => {
          let conversation: Uint8Array | undefined;
          try {
            conversation = nip44.v2.utils.getConversationKey(bytes, command.sender);
            const hex = nip44.v2.decrypt(command.ciphertext, conversation);
            if (!validHex(hex)) return false;
            const imported = hexToBytes(hex);
            try { if (command.expectedPubkey && getPublicKey(imported) !== command.expectedPubkey) return false; } finally { imported.fill(0); }
            await this.add(command.account, hex, command.createdAt);
            return true;
          } finally { conversation?.fill(0); }
        });
      }
      case 'bunkerRequest': {
        if (await this.storage.getItem(binding(command.account)) !== command.peer) throw new Error('Bunker binding requires confirmation');
        const key: VaultKey = { account: command.account, role: 'nip46-client' };
        return this.withKey(key, async bytes => {
          const params = command.operation === 'connect'
            ? [command.peer, (await this.storage.getItem(secret(command.account))) ?? ''] : command.params;
          const content = nip44.v2.encrypt(JSON.stringify({ id: command.id, method: command.operation, params }), this.conversation(key, bytes, command.peer));
          return finalizeEvent({ kind: 24133, content, tags: [['p', command.peer]], created_at: Math.floor(Date.now() / 1000) }, bytes);
        });
      }
      default: throw new Error('Unknown vault operation');
    }
  }
}
