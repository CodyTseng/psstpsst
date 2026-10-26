import { vaultAccess } from '@/platform/vault-access';
import type { Signer } from './signer.interface';

type Session = { active: boolean; signer: Promise<Signer> };
const sessions = new Map<string, Session>();

/** Account owners retain the implementation; consumers receive revocable leases. */
export function acquireAccountSigner(account: string, create: () => Promise<Signer>): Signer {
  let session = sessions.get(account);
  if (!session) {
    const owned: Session = { active: true, signer: Promise.resolve().then(create) };
    sessions.set(account, owned);
    void owned.signer.catch(() => {
      owned.active = false;
      if (sessions.get(account) === owned) sessions.delete(account);
    });
    session = owned;
  }
  const owner = session;
  let closed = false;
  const current = () => {
    if (closed || !owner.active) throw new Error('Signer session has ended');
  };
  const call = async <T>(run: (signer: Signer) => Promise<T>): Promise<T> => {
    current();
    const signer = await owner.signer;
    current();
    const result = await run(signer);
    current();
    return result;
  };
  const crypto = (method: 'nip04Encrypt' | 'nip04Decrypt' | 'nip44Encrypt' | 'nip44Decrypt', peer: string, text: string) =>
    call(signer => {
      const run = signer[method];
      if (!run) throw new Error('Unsupported encryption operation');
      return run.call(signer, peer, text);
    });
  return Object.freeze({
    getPublicKey: () => call(signer => signer.getPublicKey()),
    signEvent: template => call(signer => signer.signEvent(template)),
    nip04Encrypt: (peer, text) => crypto('nip04Encrypt', peer, text),
    nip04Decrypt: (peer, text) => crypto('nip04Decrypt', peer, text),
    nip44Encrypt: (peer, text) => crypto('nip44Encrypt', peer, text),
    nip44Decrypt: (peer, text) => crypto('nip44Decrypt', peer, text),
    destroy: () => { closed = true; },
  } satisfies Signer);
}

/** Revocation is synchronous; cleanup also covers implementations still being built. */
export async function endAccountSignerSession(account: string): Promise<void> {
  const session = sessions.get(account);
  if (!session) {
    await vaultAccess.execute({ method: 'endSession', account });
    return;
  }
  session.active = false;
  sessions.delete(account);
  await session.signer.then(signer => signer.destroy?.(), () => {});
  await vaultAccess.execute({ method: 'endSession', account });
}
