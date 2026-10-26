import assert from 'node:assert/strict';
import { getPublicKey, nip19 } from 'nostr-tools';

export async function exerciseGeneratedBackup(call) {
  const generated = (await call({ method: 'generateEphemeral', purpose: 'account' })).value;
  const backup = (await call({ testBackup: generated.pubkey })).value;
  assert.equal(getPublicKey(nip19.decode(backup).data), generated.pubkey);
  for (const method of ['generatedIdentityBackup', 'copyGeneratedIdentity', 'identityBackup']) {
    assert.equal((await call({ method, account: generated.pubkey })).error, true);
  }
  await call({ method: 'persistIdentity', account: generated.pubkey });
  await call({ method: 'persistIdentity', account: generated.pubkey });
  assert.equal((await call({ testBackup: generated.pubkey })).value, backup);
  await call({ method: 'releaseEphemeral', account: generated.pubkey });
  assert.equal((await call({ testBackup: generated.pubkey })).value, backup);
  const transfer = (await call({ method: 'generateEphemeral', purpose: 'key-sync' })).value;
  assert.equal((await call({ testBackup: transfer.pubkey })).value, null);
}
