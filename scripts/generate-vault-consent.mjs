import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const catalog = {};
for (const file of await readdir(resolve(root, 'src/i18n'))) {
  if (!file.endsWith('.json')) continue;
  const locale = JSON.parse(await readFile(resolve(root, 'src/i18n', file), 'utf8'));
  catalog[file.slice(0, -5)] = {
    backup: { title: locale.settings.export_nsec_title, message: locale.settings.export_nsec_message, confirm: locale.settings.export_nsec_confirm },
    transfer: { title: locale.key_sync.request_title, message: locale.key_sync.request_verify_hint, confirm: locale.key_sync.send_key },
    bunker: { title: locale.settings.bunker_trust_title, message: locale.settings.bunker_trust_message, confirm: locale.settings.bunker_trust_confirm },
    walletBinding: { title: locale.settings.wallet_trust_title, message: locale.settings.wallet_trust_message, confirm: locale.settings.wallet_trust_confirm },
    security: locale.secure_storage,
    wallet: Object.fromEntries(['sats_unit', 'auth_prompt', 'auth_failed', 'pin', 'confirm_pin', 'pin_setup_hint', 'pin_prompt', 'pin_incorrect', 'save_pin', 'confirm_pin_action', 'pay', 'confirm_payment'].map(key => [key, locale.wallet[key]])),
    cancel: locale.common.cancel,
  };
}
const text = JSON.stringify(catalog, null, 2) + '\n';
for (const file of ['src/i18n/native/vault-consent.json', 'modules/expo-crypto-accelerator/ios/VaultConsent.json', 'modules/expo-crypto-accelerator/android/src/main/res/raw/psst_vault_consent.json']) {
  const target = resolve(root, file); await mkdir(dirname(target), { recursive: true }); await writeFile(target, text);
}
