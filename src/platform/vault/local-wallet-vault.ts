import { walletPaymentAmount } from './wallet-payment';
import { finalizeEvent, generateSecretKey, getPublicKey, nip04, nip47, verifyEvent } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import type { LegacyWalletBinding, WalletVaultCommand, WalletOperation } from '../ports/key-vault';

type Storage = { getItem(name: string): Promise<string | null>; setItem(name: string, value: string): Promise<void>; deleteItem(name: string): Promise<void> };
type Credential = { secret: string; peer: string; relays: string[] };
const validHex = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
const operations: WalletOperation[] = ['get_info', 'get_balance', 'list_transactions', 'make_invoice', 'lookup_invoice', 'pay_invoice'];
const pinName = (account: string) => `psstpsst.wallet.pin.${account}`;
const name = (account: string, id: string) => `wallet_credential_${account}_${id}`;
const legacyName = (account: string, id: string) => `psstpsst.nwc.${account.slice(0, 16)}.${id}`;
function relays(values: string[]): string[] {
  if (!values.length) throw new Error('Invalid wallet relays');
  return Array.from(new Set(values.map(value => {
    const url = new URL(value);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid wallet relay');
    url.pathname = url.pathname.replace(/\/+/g, '/').replace(/\/$/, '');
    url.searchParams.sort(); url.hash = '';
    return url.toString();
  })));
}

/** Used only in the trusted worker. Wallet keys have no generic signing/decryption reference. */
export class LocalWalletVault {
  private pending = new Map<string, { account: string; walletId: string; method: string; expires: number }>();
  constructor(private storage: Storage) {}
  private async credential(account: string, id: string): Promise<Credential> {
    const value = await this.storage.getItem(name(account, id));
    if (value === null) throw new Error('Wallet credential requires binding');
    const result = JSON.parse(value) as Credential;
    if (!validHex(result.secret) || !validHex(result.peer)) throw new Error('Invalid wallet credential');
    return result;
  }
  async bound(account: string, id: string): Promise<boolean> {
    return await this.storage.getItem(name(account, id)) !== null;
  }
  async hasPin(account: string): Promise<boolean> { return await this.storage.getItem(pinName(account)) !== null; }
  async setPin(account: string, pin: string): Promise<void> {
    if (!validHex(account) || !/^\d{6}$/.test(pin) || await this.hasPin(account)) throw new Error('Wallet PIN already configured or invalid');
    const salt = bytesToHex(generateSecretKey());
    const digest = await scryptAsync(pin, salt, { N: 1 << 15, r: 8, p: 1, dkLen: 32 });
    try { await this.storage.setItem(pinName(account), JSON.stringify({ version: 1, salt, digest: bytesToHex(digest) })); }
    finally { digest.fill(0); }
  }
  async verifyPin(account: string, pin: string): Promise<boolean> {
    if (!validHex(account) || !/^\d{6}$/.test(pin)) return false;
    const value = await this.storage.getItem(pinName(account));
    if (value === null) return false;
    const record = JSON.parse(value);
    if (record.version !== 1 || typeof record.salt !== 'string' || record.salt.length > 256 || !validHex(record.digest)) throw new Error('Invalid wallet PIN record');
    if ((record.retryAtMs ?? 0) > Date.now()) return false;
    const expected = hexToBytes(record.digest);
    const actual = await scryptAsync(pin, record.salt, { N: 1 << 15, r: 8, p: 1, dkLen: 32 });
    let difference = 0;
    try { for (let i = 0; i < 32; i++) difference |= actual[i] ^ expected[i]; }
    finally { actual.fill(0); expected.fill(0); }
    record.failures = difference === 0 ? 0 : Math.min(32, (record.failures ?? 0) + 1);
    record.retryAtMs = difference === 0 ? 0 : Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(record.failures - 1, 5));
    await this.storage.setItem(pinName(account), JSON.stringify(record));
    if (difference === 0) return true;
    return false;
  }
  async paymentDetails(command: Extract<WalletVaultCommand, { method: 'walletRequest' }>): Promise<{ peer: string; invoice: string; amountSats: string }> {
    if (command.operation !== 'pay_invoice' || typeof command.params.invoice !== 'string' || command.params.invoice.length > 30_000) throw new Error('Invalid payment');
    if (Object.keys(command.params).some(key => !['invoice', 'metadata'].includes(key))
      || command.params.metadata !== undefined && (command.params.metadata === null || typeof command.params.metadata !== 'object' || Array.isArray(command.params.metadata))) throw new Error('Invalid payment parameters');
    return { peer: (await this.credential(command.account, command.walletId)).peer, invoice: command.params.invoice, amountSats: walletPaymentAmount(command.params.invoice) };
  }
  async migrateLegacy(binding: Omit<LegacyWalletBinding, 'method'>): Promise<void> {
    if (await this.bound(binding.account, binding.walletId)) {
      await this.storage.deleteItem(legacyName(binding.account, binding.walletId));
      return;
    }
    if (await this.storage.getItem(legacyName(binding.account, binding.walletId)) === null) return;
    await this.execute({ ...binding, method: 'walletBindLegacy' }, true);
  }
  async execute(command: WalletVaultCommand | LegacyWalletBinding, trusted = false): Promise<unknown> {
    if (!validHex(command.account)) throw new Error('Invalid wallet account');
    if ('walletId' in command && !/^[A-Za-z0-9_-]{1,256}$/.test(command.walletId)) throw new Error('Invalid wallet ID');
    if (command.method === 'walletImport') {
      if (typeof command.connectionString !== 'string' || command.connectionString.length > 32_768 || !/^nostr\+walletconnect:\/\//i.test(command.connectionString.trim())) throw new Error('Invalid wallet connection');
      const parsed = nip47.parseConnectionString(command.connectionString.trim());
      if (!validHex(parsed.secret) || !validHex(parsed.pubkey)) throw new Error('Invalid wallet connection');
      const bytes = hexToBytes(parsed.secret);
      try { getPublicKey(bytes); } finally { bytes.fill(0); }
      const id = `nwc_${bytesToHex(generateSecretKey()).slice(0, 32)}`;
      const selected = relays(parsed.relays);
      await this.storage.setItem(name(command.account, id), JSON.stringify({ secret: parsed.secret, peer: parsed.pubkey.toLowerCase(), relays: selected }));
      return { id, walletPubkey: parsed.pubkey.toLowerCase(), relays: selected };
    }
    if (command.method === 'walletBindLegacy') {
      if (!trusted || !validHex(command.peer)) throw new Error('Wallet binding requires internal migration');
      if (await this.bound(command.account, command.walletId)) return null;
      const secret = await this.storage.getItem(legacyName(command.account, command.walletId));
      if (!validHex(secret)) throw new Error('Missing wallet credential');
      const selected = relays(command.relays);
      await this.storage.setItem(name(command.account, command.walletId), JSON.stringify({ secret, peer: command.peer.toLowerCase(), relays: selected }));
      await this.storage.deleteItem(legacyName(command.account, command.walletId));
      return null;
    }
    if (command.method === 'walletRemovePin') { await this.storage.deleteItem(pinName(command.account)); return null; }
    if (command.method === 'walletRemove') {
      await this.storage.deleteItem(name(command.account, command.walletId));
      await this.storage.deleteItem(legacyName(command.account, command.walletId));
      for (const [id, entry] of this.pending) if (entry.account === command.account && entry.walletId === command.walletId) this.pending.delete(id);
      return null;
    }
    const credential = await this.credential(command.account, command.walletId);
    const secret = hexToBytes(credential.secret);
    try {
      if (command.method === 'walletRequest') {
        if (!operations.includes(command.operation) || (command.operation === 'pay_invoice' && !trusted)) throw new Error('Wallet payment requires trusted authentication');
        if (command.operation === 'pay_invoice') await this.paymentDetails(command);
        for (const [id, entry] of this.pending) if (entry.expires < Date.now()) this.pending.delete(id);
        if (this.pending.size >= 128) throw new Error('Too many wallet requests');
        const content = await nip04.encrypt(secret, credential.peer, JSON.stringify({ method: command.operation, params: command.params }));
        const event = finalizeEvent({ kind: 23194, created_at: Math.floor(Date.now() / 1000), content, tags: [['p', credential.peer]] }, secret);
        this.pending.set(event.id, { account: command.account, walletId: command.walletId, method: command.operation, expires: Date.now() + 60_000 });
        return { event, peer: credential.peer, relays: credential.relays };
      }
      if (command.method === 'walletReceive') {
        const pending = this.pending.get(command.requestId), event = command.event;
        if (!pending || pending.account !== command.account || pending.walletId !== command.walletId || pending.expires < Date.now()
          || !verifyEvent(event) || event.kind !== 23195 || event.pubkey !== credential.peer || !event.tags.some(tag => tag[0] === 'e' && tag[1] === command.requestId)) return null;
        const response = JSON.parse(await nip04.decrypt(secret, event.pubkey, event.content));
        if (!response || typeof response !== 'object' || response.result_type !== pending.method || (!response.result && !response.error) || 'params' in response || 'method' in response) return null;
        this.pending.delete(command.requestId);
        return response;
      }
      if (command.method === 'walletRelayAuth') {
        const template = command.template;
        if (template.kind !== 22242 || template.content !== '' || template.tags.length !== 2
          || !template.tags.some(tag => tag.length === 2 && tag[0] === 'challenge')
          || !template.tags.some(tag => tag.length === 2 && tag[0] === 'relay' && credential.relays.includes(new URL(tag[1]).toString()))) throw new Error('Invalid wallet relay authentication');
        return finalizeEvent(template, secret);
      }
      throw new Error('Invalid wallet operation');
    } finally { secret.fill(0); }
  }
}
