import type { Event } from 'nostr-tools';

import { buildSigner, getAccount } from '@/services/account/account.service';
import {
  generateClientKeypair,
  getClientPubkeyFromEvent,
  getEncryptionPubkeyFromEvent,
  getVerificationCode,
  publishClientKeyAnnouncement,
  queryEncryptionKeyAnnouncement,
  subscribeToKeyTransfer,
  type EncryptionKeypair,
} from '@/services/dm/encryption-key.service';
import { markSyncRequestProcessed } from '@/services/dm/sync-store';
import {
  ownKeyAnnouncementRelays,
  ownKeyTransferRelays,
} from '@/services/relay/relay-list.service';
import type { Signer } from '@/services/signer/signer.interface';

type KeySyncTransport = {
  signer: Signer;
  keyTransferRelays: string[];
  clientKeypair: EncryptionKeypair;
  expectedEncryptionPubkey: string | null;
  unsubscribe: () => void;
};

type KeySyncSessionOptions = {
  accountPubkey: string;
  onCode: (code: string) => void;
  onTransfer: () => void;
  onRejected?: () => void;
};

export type KeySyncRequestDisposition = 'accept' | 'duplicate' | 'replace';

/** Decide how an already-open approval should handle another 4454. A retry
 * keeps the same ephemeral client key; a remounted requester does not. */
export function classifyKeySyncRequest(
  current: Event | null,
  incoming: Event,
): KeySyncRequestDisposition {
  if (!current) return 'accept';
  return getClientPubkeyFromEvent(current) === getClientPubkeyFromEvent(incoming)
    ? 'duplicate'
    : 'replace';
}

/** A 4455 addresses both the account and the requester's ephemeral client key.
 * Matching that client key tells another approving device that this request has
 * already been fulfilled, without exposing or decrypting the transferred key. */
export function isKeySyncRequestResolvedByTransfer(request: Event, transfer: Event): boolean {
  const clientPubkey = getClientPubkeyFromEvent(request);
  return !!clientPubkey && transfer.tags.some((tag) => tag[0] === 'p' && tag[1] === clientPubkey);
}

export type KeySyncSessionDependencies = {
  buildSigner: typeof buildSigner;
  getAccount: typeof getAccount;
  generateClientKeypair: typeof generateClientKeypair;
  getEncryptionPubkeyFromEvent: typeof getEncryptionPubkeyFromEvent;
  getVerificationCode: typeof getVerificationCode;
  markSyncRequestProcessed: typeof markSyncRequestProcessed;
  ownKeyAnnouncementRelays: typeof ownKeyAnnouncementRelays;
  ownKeyTransferRelays: typeof ownKeyTransferRelays;
  publishClientKeyAnnouncement: typeof publishClientKeyAnnouncement;
  queryEncryptionKeyAnnouncement: typeof queryEncryptionKeyAnnouncement;
  subscribeToKeyTransfer: typeof subscribeToKeyTransfer;
};

const defaultDependencies: KeySyncSessionDependencies = {
  buildSigner,
  getAccount,
  generateClientKeypair,
  getEncryptionPubkeyFromEvent,
  getVerificationCode,
  markSyncRequestProcessed,
  ownKeyAnnouncementRelays,
  ownKeyTransferRelays,
  publishClientKeyAnnouncement,
  queryEncryptionKeyAnnouncement,
  subscribeToKeyTransfer,
};

/**
 * One ephemeral key-transfer exchange for the lifetime of a sync screen.
 *
 * Initialization and request publication are single-flight. Retrying publishes
 * a fresh kind-4454 event with the same client key, pairing code, and durable
 * kind-4455 subscription, so an approval sheet already open on another device
 * can never target a client key that this device has stopped listening for.
 */
export class KeySyncSession {
  private transport: KeySyncTransport | null = null;
  private requestWork: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly options: KeySyncSessionOptions,
    private readonly dependencies: KeySyncSessionDependencies = defaultDependencies,
  ) {}

  /** Publish (or republish) this session's request. Concurrent calls share work. */
  request(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Key sync session is closed.'));
    if (this.requestWork) return this.requestWork;

    const work = this.requestInternal();
    this.requestWork = work;
    const clear = () => {
      if (this.requestWork === work) this.requestWork = null;
    };
    void work.then(clear, clear);
    return work;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport?.unsubscribe();
    this.transport = null;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Key sync session is closed.');
  }

  private async requestInternal(): Promise<void> {
    const transport = await this.ensureTransport();
    this.assertOpen();
    const request = await this.dependencies.publishClientKeyAnnouncement({
      signer: transport.signer,
      clientPubkey: transport.clientKeypair.pubkey,
      relays: transport.keyTransferRelays,
      expectedEncryptionPubkey: transport.expectedEncryptionPubkey,
    });
    this.assertOpen();
    await this.dependencies.markSyncRequestProcessed(
      this.options.accountPubkey,
      request.id,
    );
    this.assertOpen();
  }

  private async ensureTransport(): Promise<KeySyncTransport> {
    if (this.transport) return this.transport;
    this.assertOpen();

    const clientKeypair = this.dependencies.generateClientKeypair();
    this.options.onCode(this.dependencies.getVerificationCode(clientKeypair.pubkey));

    const signer = await this.dependencies.buildSigner(this.options.accountPubkey);
    this.assertOpen();
    const keyTransferRelays = await this.dependencies.ownKeyTransferRelays(
      this.options.accountPubkey,
    );
    this.assertOpen();
    const keyRelays = await this.dependencies.ownKeyAnnouncementRelays(
      this.options.accountPubkey,
    );
    this.assertOpen();
    const announcement = await this.dependencies.queryEncryptionKeyAnnouncement(
      this.options.accountPubkey,
      keyRelays,
    );
    this.assertOpen();
    const account = await this.dependencies.getAccount(this.options.accountPubkey);
    this.assertOpen();

    const expectedEncryptionPubkey =
      (announcement
        ? this.dependencies.getEncryptionPubkeyFromEvent(announcement)
        : null) ??
      account?.encryptionPubkey ??
      null;
    const expectedEncryptionCreatedAt = announcement?.created_at ?? null;

    const unsubscribe = this.dependencies.subscribeToKeyTransfer({
      accountPubkey: this.options.accountPubkey,
      clientKeypair,
      relays: keyTransferRelays,
      signer,
      expectedEncryptionPubkey,
      expectedEncryptionCreatedAt,
      onTransfer: () => {
        if (this.closed) return;
        this.close();
        this.options.onTransfer();
      },
      onRejected: () => {
        if (!this.closed) this.options.onRejected?.();
      },
    });
    if (this.closed) {
      unsubscribe();
      throw new Error('Key sync session is closed.');
    }

    const transport = {
      signer,
      keyTransferRelays,
      clientKeypair,
      expectedEncryptionPubkey,
      unsubscribe,
    };
    this.transport = transport;
    return transport;
  }
}
