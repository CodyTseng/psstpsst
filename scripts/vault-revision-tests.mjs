import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

export async function exerciseVaultRevision(call, revision) {
  const account = getPublicKey(generateSecretKey());
  const generated = (await call({ method: 'generateMessaging', account })).value;
  const initial = await revision();
  await call({ method: 'getCurrentMessagingKey', account });
  assert.equal(await revision(), initial);
  await call({ method: 'generateMessaging', account });
  assert.ok(await revision() > initial);
  const recipient = (await call({ method: 'generateEphemeral', purpose: 'key-sync' })).value;
  const transfer = (await call({ method: 'exportTransfer', account, pubkey: generated.pubkey, recipient: recipient.pubkey })).value;
  const beforeImport = await revision();
  const imported = await call({ method: 'importTransfer', account: getPublicKey(generateSecretKey()), client: recipient.key,
    sender: transfer.senderPubkey, ciphertext: transfer.content, expectedPubkey: generated.pubkey, createdAt: 100 });
  assert.equal(imported.value, true);
  assert.ok(await revision() > beforeImport);
}
