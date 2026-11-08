import { isAppAuthorizationLevel, type AppAuthorizationLevel } from '@/services/app-authorization/model';
import { assertNotAborted } from '@/platform/abort';
import { queueAuthorization } from '../signing/authorization-queue';
import { signingRevision, subscribeSigning } from '../signing/changes';
import { readAppAuthorizationLevel, saveAppAuthorizationLevel, type SigningAccountScope } from '../signing/repository';
import { normalizeSigningSource } from '../signing/source';

/** Select once before launch, including apps which never request account methods. */
export async function ensureAppAuthorizationLevel(scope: SigningAccountScope,
  choose: (signal: AbortSignal) => Promise<string | false>, signal: AbortSignal,
  current: () => void = () => {}) : Promise<AppAuthorizationLevel> {
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
      const saved = await readAppAuthorizationLevel(scope);
      guard();
      if (saved) return saved;
      const selected = await choose(signal);
      guard();
      if (!isAppAuthorizationLevel(selected)) throw new Error('permission-denied');
      await saveAppAuthorizationLevel(scope, selected, guard);
      assertNotAborted(signal); current();
      return selected;
    });
  } finally { detach(); }
}
