import type { Event, EventTemplate } from 'nostr-tools';
export type VaultConsent = { language?: string };
export type ImportedIdentity = { pubkey: string };
export type ImportedWallet = { id: string; walletPubkey: string; relays: string[] };

export type VaultKey = { account: string; role: 'identity' | 'messaging' | 'nip46-client' | 'ephemeral' | 'proximity'; pubkey?: string };
export type MessagingKey = { pubkey: string; createdAt: number; key: VaultKey };
export type MessagingDecryption =
  | { status: 'decrypted'; seal: Event; rumorJson: string; senderEncryptionPubkey: string }
  | { status: 'unsupported'; reason: 'missing-encryption-key-tag' }
  | { status: 'failed' };
export type BunkerPairing = { session: string; clientPubkey: string; uri: string | null };
export type PairedBunker = { pubkey: string; pointer: { pubkey: string; relays: string[]; secret: null }; existing: boolean };
export type PairingResponse = { type: 'ignored' | 'connected' | 'rejected' } | { type: 'peer'; peer: string } | { type: 'auth'; url: string } | { type: 'account'; pubkey: string };
export type WalletOperation = 'get_info' | 'get_balance' | 'list_transactions' | 'make_invoice' | 'lookup_invoice' | 'pay_invoice';
export type LegacyWalletBinding = { method: 'walletBindLegacy'; account: string; walletId: string; peer: string; relays: string[] };
export type WalletVaultCommand =
  | { method: 'walletImport'; account: string; connectionString: string }
  | { method: 'walletRequest'; account: string; walletId: string; operation: WalletOperation; params: Record<string, unknown>; confirmation: VaultConsent }
  | { method: 'walletReceive'; account: string; walletId: string; requestId: string; event: Event }
  | { method: 'walletRelayAuth'; account: string; walletId: string; template: EventTemplate }
  | { method: 'walletRemove'; account: string; walletId: string }
  | { method: 'walletRemovePin'; account: string };
export type VaultCommand = WalletVaultCommand
  | { method: 'migrateStorage'; accounts: string[]; bunkers?: { account: string; peer: string }[]; wallets: Omit<LegacyWalletBinding, 'method'>[] }
  | { method: 'ensureProximity' | 'removeProximity'; account: string }
  | { method: 'bindProximityNoise'; account: string; noisePubkey: string }
  | { method: 'beginBunkerPairing'; peer: string | null; secret: string | null; relays: string[] }
  | { method: 'bunkerPairingRequest'; session: string; operation: 'connect' | 'get_public_key' }
  | { method: 'bunkerPairingReceive'; session: string; event: Event }
  | { method: 'commitBunkerPairing' | 'cancelBunkerPairing'; session: string }
  | { method: 'generateEphemeral'; purpose: 'account' | 'key-sync' }
  | { method: 'persistIdentity' | 'releaseEphemeral' | 'endSession'; account: string }
  | { method: 'migrateBunkerSecret'; account: string; secret: string | null; peer: string }
  | { method: 'removeIdentity' | 'removeBunker' | 'removeMessaging'; account: string }
  | { method: 'publicKey'; key: VaultKey }
  | { method: 'signEvent'; key: VaultKey; template: EventTemplate }
  | { method: 'crypto'; key: VaultKey; algorithm: 'nip04' | 'nip44'; operation: 'encrypt' | 'decrypt'; cache?: boolean; peer: string; text: string }
  | { method: 'getCurrentMessagingKey' | 'generateMessaging'; account: string }
  | { method: 'hasMessagingKey'; account: string; pubkey: string }
  | { method: 'decryptMessaging'; account: string; event: Event }
  | { method: 'exportTransfer'; account: string; pubkey: string | null; recipient: string; confirmation: VaultConsent }
  | { method: 'importTransfer'; account: string; client: VaultKey; sender: string; ciphertext: string; expectedPubkey: string | null; createdAt: number }
  | { method: 'bunkerRequest'; account: string; peer: string; id: string; operation: string; params: string[]; confirmation: VaultConsent };

/** Secret reads are deliberately absent. Backup returns only an outcome. */
export interface KeyVaultPort {
  importIdentity(nsec: string): Promise<ImportedIdentity>;
  execute(command: VaultCommand): Promise<unknown>;
  backupIdentity(account: string, confirmation: VaultConsent): Promise<boolean>;
}

const methods = {
  ensureProximity: true, removeProximity: true, bindProximityNoise: true,
  beginBunkerPairing: true, bunkerPairingRequest: true, bunkerPairingReceive: true,
  commitBunkerPairing: true, cancelBunkerPairing: true,
  generateEphemeral: true, persistIdentity: true, releaseEphemeral: true, endSession: true,
  migrateBunkerSecret: true, removeIdentity: true, removeBunker: true, removeMessaging: true,
  publicKey: true, signEvent: true, crypto: true, getCurrentMessagingKey: true, hasMessagingKey: true, generateMessaging: true,
  decryptMessaging: true, exportTransfer: true, importTransfer: true, bunkerRequest: true,
  migrateStorage: true, walletImport: true, walletRequest: true, walletReceive: true,
  walletRelayAuth: true, walletRemove: true, walletRemovePin: true,
} satisfies Record<VaultCommand['method'], true>;

/** Dispatch names are closed; each vault operation validates its own arguments. */
export function isVaultMethod(value: unknown): value is VaultCommand['method'] {
  return typeof value === 'string' && Object.hasOwn(methods, value);
}

export function isVaultStorageKey(key: string): boolean {
  return /^(?:psstpsst\.nwc\.|psstpsst\.wallet\.pin\.)/.test(key) || /(?:^|-)(identity_privkey_|encryption_keys_|nip46_client_privkey_|nip46_bunker_secret_|nip46_bunker_binding_|proximity_identity_privkey_|proximity_identity_noise_privkey_|wallet_credential_)/.test(key);
}
