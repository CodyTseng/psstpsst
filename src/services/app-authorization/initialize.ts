import { isAppAuthorizationPreset, type AppAuthorization } from '@/services/app-authorization/model';
import { assertNotAborted } from '@/platform/abort';
import { queueAuthorization } from '../signing/authorization-queue';
import { signingRevision, subscribeSigning } from '../signing/changes';
import { readAppAuthorization, initializeAppAuthorization, type SigningAccountScope } from '../signing/repository';
import { normalizeSigningSource } from '../signing/source';

/** Initialize shared permissions before launch or the first provider request. */
export async function ensureAppAuthorization(scope: SigningAccountScope,
  choose: (signal: AbortSignal) => Promise<string | false>, signal: AbortSignal,
  current: () => void = () => {}) : Promise<AppAuthorization> {
  scope = { ...scope, sourceId: normalizeSigningSource(scope.sourceId) };
  const detach = subscribeSigning(scope, () => {});
  try {
    return await queueAuthorization(scope, [signal], async () => {
      const revision = signingRevision(scope);
      const guard = () => {
        assertNotAborted(signal); current();
        if (signingRevision(scope) !== revision) throw new Error('permission-revoked');
      };
      guard();
      const saved = await readAppAuthorization(scope);
      guard();
      if (saved) return saved;
      const selected = await choose(signal);
      guard();
      if (!isAppAuthorizationPreset(selected)) throw new Error('permission-denied');
      await initializeAppAuthorization(scope, selected, guard);
      assertNotAborted(signal); current();
      return { fullyTrusted: selected === 'trusted' };
    });
  } finally { detach(); }
}
