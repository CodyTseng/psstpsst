import { vaultConsent } from '../vault-consent';
import catalog from '../../src/i18n/native/vault-consent.json';

test('native approvals select only bundled text, including for invalid locale selectors', () => {
  expect(vaultConsent('__proto__', 'en', 'backup')).toEqual({ ...catalog.en.backup, cancel: catalog.en.cancel });
  expect(vaultConsent({ title: 'Misleading title' }, 'en-US', 'bunker')).toEqual({ ...catalog.en.bunker, cancel: catalog.en.cancel });
});
