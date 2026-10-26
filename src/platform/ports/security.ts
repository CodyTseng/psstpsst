export type SecuritySelection = { language?: string };
export type StorageAccess = 'available' | 'password_setup_required' | 'password_required';

/** Trusted input surfaces return outcomes, never passwords, PINs or credential bytes. */
export interface SecurityPort {
  accessStatus(): Promise<StorageAccess>;
  requestUnlock(mode: 'setup' | 'unlock', selection: SecuritySelection): Promise<boolean>;
  ensureWalletProtection(account: string, selection: SecuritySelection): Promise<boolean>;
  readLegacyPreference(key: string): Promise<string | null>;
  deleteLegacyPreference(key: string): Promise<void>;
}

/** An explicit migration allowlist prevents preference migration becoming a credential reader. */
export function isLegacyPreferenceKey(key: string): boolean {
  return ['language.preference', 'theme.preference', 'theme.accent', 'chat.enterToSend', 'chat.quickReactions'].includes(key)
    || key === 'active_account_pubkey' || key === 'notifications.enabled' || /^wallet\.balanceVisible\.[0-9a-f]{16}$/i.test(key);
}
