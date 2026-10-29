import type { Event, EventTemplate } from 'nostr-tools';
import { signingTemplate } from './event-template';
import type { Signer } from '@/services/signer/signer.interface';
import type { SigningPermissions } from './permissions';

/** The host binds permissions to the verified current source, never to page-supplied origins. */
export class ApplicationSigner {
  constructor(private options: {
    accountPubkey: string;
    permissions: SigningPermissions;
    signer(): Promise<Signer>;
    current(): void;
  }) {}

  private current(revision: number) {
    this.options.current();
    if (this.options.permissions.version !== revision) throw new Error('permission-revoked');
  }

  async getPublicKey(): Promise<string> {
    const revision = await this.options.permissions.authorizeAccess('get-public-key');
    this.current(revision);
    // The account key is already known; identity disclosure needs no remote signer round trip.
    return this.options.accountPubkey;
  }

  /** Publication stays ordinary signing; direct authentication requests retain their own action. */
  async signEvent(input: unknown, sign: (template: EventTemplate) => Promise<Event>, options: { publication?: boolean; relays?: readonly string[] } = {}) {
    const template = signingTemplate(input, !options.publication);
    const operation = options.publication ? 'sign' : template.kind === 22242 ? 'relay-auth' : template.kind === 27235 ? 'http-auth' : 'sign';
    const revision = await this.options.permissions.authorize({ operation, kind: template.kind,
      relays: operation === 'relay-auth' ? [template.tags.find(tag => tag[0] === 'relay')![1]] : [...(options.relays ?? [])],
      accountPubkey: this.options.accountPubkey, content: template.content,
      tags: template.tags, createdAt: template.created_at });
    this.current(revision);
    const event = await sign(template);
    this.current(revision);
    return { event, revision };
  }

  async crypto(algorithm: 'nip04' | 'nip44', operation: 'encrypt' | 'decrypt', peer: unknown, text: unknown): Promise<string> {
    if (typeof peer !== 'string' || !/^[a-f0-9]{64}$/.test(peer) || typeof text !== 'string' || !text)
      throw new Error('invalid-crypto-request');
    const revision = await this.options.permissions.authorizeAccess(`${algorithm}-${operation}`, undefined, operation === 'encrypt' ? text : '');
    this.current(revision);
    const signer = await this.options.signer(); this.current(revision);
    const key = `${algorithm}${operation === 'encrypt' ? 'Encrypt' : 'Decrypt'}` as 'nip04Encrypt' | 'nip04Decrypt' | 'nip44Encrypt' | 'nip44Decrypt';
    const run = signer[key];
    if (!run) throw new Error('unsupported-encryption');
    // Let the consent UI paint before local cryptographic work starts.
    await new Promise<void>(resolve => setTimeout(resolve, 0)); this.current(revision);
    const result = await run.call(signer, peer, text);
    this.current(revision);
    return result;
  }
}
