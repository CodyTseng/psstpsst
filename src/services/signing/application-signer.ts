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

  async crypto(algorithm: 'nip04' | 'nip44', operation: 'encrypt' | 'decrypt', peer: unknown, text: unknown): Promise<string> {
    if (typeof peer !== 'string' || !/^[a-f0-9]{64}$/.test(peer) || typeof text !== 'string' || !text || text.length > 100000)
      throw new Error('invalid-crypto-request');
    const revision = await this.options.permissions.authorizeAccess(`${algorithm}-${operation}`, undefined, operation === 'encrypt' ? text : '');
    this.current(revision);
    const signer = await this.options.signer(); this.current(revision);
    const key = `${algorithm}${operation === 'encrypt' ? 'Encrypt' : 'Decrypt'}` as 'nip04Encrypt' | 'nip04Decrypt' | 'nip44Encrypt' | 'nip44Decrypt';
    const run = signer[key];
    if (!run) throw new Error('unsupported-encryption');
    // Let the consent UI paint before local cryptographic work starts.
    await new Promise<void>(resolve => setTimeout(resolve, 0)); this.current(revision);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([run.call(signer, peer, text), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('crypto-timeout')), 25000);
      })]);
      this.current(revision);
      return result;
    } finally { clearTimeout(timer); }
  }
}
