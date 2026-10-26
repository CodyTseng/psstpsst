import { platform } from '@/platform';
import type { PushDevice } from '@/platform/ports/push-notifications';
import { buildSigner, listAccounts } from '@/services/account/account-access';
import { getDevicePreference, setDevicePreference } from '@/services/preferences/device-preferences.service';
import { loadAccountDmRelays } from '@/services/relay/local-relay-settings';

import { mutatePushDevice, PushApiError, supportsPush } from './push-api';
import { getNotificationsEnabled } from './notification-prefs';

const STATE_KEY = 'notifications.apnsRegistrations';
const INSTALLATION_KEY = 'notifications.apnsInstallationId';
type Registration = PushDevice & {
  accountPubkey: string;
  origin: string;
  confirmed: boolean;
  revoke: boolean;
};

/** Only saved inbox relays are eligible. Notification payloads never select destinations. */
function pushOrigin(relay: string): string | null {
  try {
    const url = new URL(relay);
    if (url.protocol !== 'wss:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) return null;
    return `https://${url.host}`;
  } catch { return null; }
}

export class PushRegistrationService {
  private enabled: boolean | null = null;
  private queue: Promise<void> = Promise.resolve();
  private registrations: Registration[] | null = null;
  private installationId: string | null = null;
  private loading: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private readonly capabilities = new Map<string, { supported: boolean; expiresAt: number }>();
  private readonly removingAccounts = new Set<string>();

  /** Sets consent synchronously so an in-flight register cannot keep adding accounts. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.retryCount = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!enabled && platform.pushNotifications?.isAvailable()) {
      // Cancel native token acquisition immediately, independently of slow relay revocations.
      void platform.pushNotifications.unregister().catch((error) => {
        console.warn('[push] Unable to unregister with APNs.', error);
      });
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  reconcile(): Promise<void> {
    if (!platform.pushNotifications?.isAvailable()) return Promise.resolve();
    return this.enqueue(async () => {
      try {
        await this.sync();
        this.retryCount = 0;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
      } catch (error) {
        this.retry(error);
        console.warn('[push] Unable to reconcile APNs registration.', error);
      }
    });
  }

  private retry(error: unknown): void {
    if (error instanceof PushApiError && ![401, 409, 413, 503].includes(error.status)) return;
    if (this.retryTimer || this.retryCount >= 3) return;
    const delay = 1_000 * 2 ** this.retryCount++ + Math.random() * 500;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.reconcile();
    }, delay);
  }

  private async load(): Promise<void> {
    if (this.registrations) return;
    if (!this.loading) {
      this.loading = (async () => {
        const [stored, installationId] = await Promise.all([
          getDevicePreference(STATE_KEY), getDevicePreference(INSTALLATION_KEY),
        ]);
        // Corruption must not silently discard a pending revocation.
        this.registrations = stored ? JSON.parse(stored) as Registration[] : [];
        this.installationId = installationId;
      })().finally(() => { this.loading = null; });
    }
    await this.loading;
  }

  private async save(): Promise<void> {
    await setDevicePreference(STATE_KEY, JSON.stringify(this.registrations));
  }

  private async supported(origin: string): Promise<boolean> {
    const cached = this.capabilities.get(origin);
    if (cached && cached.expiresAt > Date.now()) return cached.supported;
    const supported = await supportsPush(origin);
    this.capabilities.set(origin, { supported, expiresAt: Date.now() + 10 * 60_000 });
    return supported;
  }

  private async revoke(registration: Registration): Promise<void> {
    if (!this.installationId) throw new Error('Missing APNs installation ID');
    const signer = await buildSigner(registration.accountPubkey);
    try {
      await mutatePushDevice(signer, registration.origin, this.installationId, null);
      this.registrations = this.registrations!.filter((entry) => entry !== registration);
      await this.save();
    } finally { await signer.destroy?.(); }
  }

  private async sync(): Promise<void> {
    await this.load();
    if (this.enabled === null) {
      const enabled = await getNotificationsEnabled();
      // An explicit toggle during the storage read has precedence.
      if (this.enabled === null) this.enabled = enabled;
    }
    const granted = this.enabled && await platform.notifications.hasPermission();
    const desired = new Map<string, Set<string>>();
    if (granted) {
      for (const account of await listAccounts()) {
        if (this.removingAccounts.has(account.pubkey)) continue;
        desired.set(account.pubkey, new Set((await loadAccountDmRelays(account.pubkey))
          .map(pushOrigin).filter((origin): origin is string => origin !== null)));
      }
    }
    for (const entry of this.registrations!) {
      if (!this.enabled || !desired.get(entry.accountPubkey)?.has(entry.origin)) entry.revoke = true;
    }
    await this.save();
    let failure: unknown;
    for (const entry of [...this.registrations!]) {
      if (!entry.revoke) continue;
      try { await this.revoke(entry); } catch (error) { failure = error; }
    }
    if (!this.enabled || !granted) {
      await platform.pushNotifications.unregister();
      if (failure) throw failure;
      return;
    }
    const device = await platform.pushNotifications.getDevice();
    if (!device || !this.enabled) return;
    if (!this.installationId) {
      const installationId = await platform.deviceCrypto.randomUUID();
      await setDevicePreference(INSTALLATION_KEY, installationId);
      this.installationId = installationId;
    }
    for (const [accountPubkey, origins] of desired) {
      for (const origin of origins) {
        if (!this.enabled) return;
        if (this.removingAccounts.has(accountPubkey)) break;
        let entry = this.registrations!.find((row) => row.accountPubkey === accountPubkey && row.origin === origin);
        if (entry?.revoke) continue;
        if (entry?.confirmed && entry.token === device.token && entry.environment === device.environment) continue;
        try {
          if (!await this.supported(origin) || !this.enabled) continue;
          const signer = await buildSigner(accountPubkey);
          try {
            if (!this.enabled || this.removingAccounts.has(accountPubkey)) break;
            if (!entry) {
              entry = { accountPubkey, origin, ...device, confirmed: false, revoke: false };
              this.registrations!.push(entry);
            } else Object.assign(entry, device, { confirmed: false });
            // Write ahead: a lost PUT response still requires DELETE on opt-out.
            await this.save();
            if (!this.enabled || this.removingAccounts.has(accountPubkey)) break;
            await mutatePushDevice(signer, origin, this.installationId, device,
              () => this.enabled === true && !this.removingAccounts.has(accountPubkey));
            entry.confirmed = true;
            await this.save();
          } finally { await signer.destroy?.(); }
        } catch (error) { failure = error; }
      }
    }
    if (failure) throw failure;
  }

  accountAdded(accountPubkey: string): void {
    this.removingAccounts.delete(accountPubkey);
    void this.reconcile();
  }

  /** Removal must retain the signer if offline, so a server registration cannot be orphaned. */
  revokeAccount(accountPubkey: string): Promise<void> {
    if (!platform.pushNotifications?.isAvailable()) return Promise.resolve();
    this.removingAccounts.add(accountPubkey);
    return this.enqueue(async () => {
      await this.load();
      const entries = this.registrations!.filter((entry) => entry.accountPubkey === accountPubkey);
      entries.forEach((entry) => { entry.revoke = true; });
      await this.save();
      for (const entry of entries) await this.revoke(entry);
    });
  }
}

export const pushRegistrationService = new PushRegistrationService();
