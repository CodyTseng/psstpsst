import { create } from 'zustand';

import { createPerfSpan, profileAsync } from '@/lib/perf/profiler';
import { initializeGeneratedAccount } from '@/services/account/generated-account-setup';
import {
  clearActiveAccountPubkey,
  getAccount,
  getActiveAccountPubkey,
  migrateNip46BunkerSecrets,
  removeAccount as removeAccountFromStore,
  setAccountEncryptionPubkey,
  setActiveAccountPubkey,
} from '@/services/account/account.service';
import { dmService } from '@/services/dm/dm.service';
import {
  beginMessagingSendPreparation,
  cancelMessagingSendPreparation,
  completeMessagingSendPreparation,
  failMessagingSendPreparation,
} from '@/services/dm/messaging-send-readiness';
import {
  rotateEncryptionKey,
  rotateEncryptionKeyIfDue,
} from '@/services/dm/encryption-key-rotation.service';
import { configurationPublisher } from '@/services/relay/configuration-publish.service';
import { relayPool } from '@/services/relay/relay-pool';
import {
  MessagingKeySyncRequiredError,
  type MessagingMetadata,
} from '@/services/dm/messaging-metadata';
import { resolveMessagingMetadataForStartup } from '@/services/dm/messaging-startup-retry';
import {
  generateEncryptionKeypair,
  getEncryptionPubkeyFromEvent,
  loadEncryptionKeys,
  publishEncryptionKeyAnnouncement,
} from '@/services/dm/encryption-key.service';
import {
  loadAccountDmRelays,
  ownKeyAnnouncementRelays,
  saveAndPublishDmRelays,
} from '@/services/relay/relay-list.service';
import { createSigner } from '@/services/signer/signer-factory';

type Status = 'idle' | 'loading' | 'ready' | 'need_sync' | 'error';

/**
 * What the account bootstrap is doing right now, surfaced so the boot screen
 * can tell the user instead of showing a bare spinner. `null` when no bootstrap
 * is in flight. The labels are intentionally coarse — they map 1:1 to a
 * plain-language line (see `boot.*` i18n keys).
 */
export type BootPhase =
  | 'signing_in' // just logged in (setActive)
  | 'initializing' // setting up a brand-new / freshly-imported account (no local key yet)
  | 'fetching_keys' // looking up the account's keys over the network
  | 'loading_messages'; // opening the message stream

type State = {
  activePubkey: string | null;
  status: Status;
  bootPhase: BootPhase | null;
  error: string | null;
  /** Account awaiting Key Transfer from another device (status === 'need_sync'). */
  syncTargetPubkey: string | null;
  /** When switching between accounts (not a first sign-in), the account we're
   * switching *to* — so the loading screen can show that account's avatar + name
   * instead of the branded boot screen. `null` outside a switch. */
  switchingTo: string | null;
  loadFromStorage: () => Promise<void>;
  setActive: (pubkey: string) => Promise<void>;
  /** Leave the current session without deleting the account or its local data. */
  signOut: () => Promise<void>;
  /** Forget an account: wipe its keys and local data, and — if it was the
   * active one — switch to the most-recently-used remaining account (or fall to
   * onboarding when none are left). */
  removeAccount: (pubkey: string) => Promise<void>;
  completeSync: () => Promise<void>;
  /** Keep local key history and re-enter sync after another device rotated the
   * current encryption key. */
  requireResync: (newEncryptionPubkey: string) => Promise<void>;
  /** Generate a brand-new encryption key, retain the bounded old-key history,
   * announce it (kind 10044), and re-init DM. Other devices are pushed to
   * re-sync via rotation detection. */
  resetEncryptionKey: () => Promise<void>;
};

type BootstrapResult = { kind: 'ready' } | { kind: 'need_sync' };

let bootstrapAbort: AbortController | null = null;

function beginBootstrap(): AbortSignal {
  bootstrapAbort?.abort();
  bootstrapAbort = new AbortController();
  return bootstrapAbort.signal;
}

function checkBootstrap(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Account bootstrap was cancelled.');
}

async function bootstrapAccount(
  pubkey: string,
  onPhase: (phase: BootPhase) => void,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  const profile = createPerfSpan('boot.bootstrapAccount');
  let outcome = 'unknown';
  try {
    const account = await profileAsync(profile, 'db.getAccount', () => getAccount(pubkey));
    if (!account) throw new Error('Account not found');

    const signer = await profileAsync(profile, 'signer.create', () =>
      createSigner({
        accountPubkey: pubkey,
        signerType: account.signerType,
        signerPayload: account.signerPayload,
      }),
    );

    const keys = await profileAsync(profile, 'db.loadEncryptionKeys', () =>
      loadEncryptionKeys(pubkey),
    );
    onPhase(keys.length === 0 ? 'initializing' : 'fetching_keys');
    const metadata = await profileAsync(profile, 'relay.resolveMessagingMetadata', () =>
      resolveMessagingMetadataForStartup(pubkey, {
        signAuth: (event) => signer.signEvent(event),
        abort: signal,
      }),
    );
    checkBootstrap(signal);
    const { dmRelays, announcementRelays: keyAnnouncementRelays, announcement } = metadata;
    const remote = announcement ? getEncryptionPubkeyFromEvent(announcement) : null;

    if (keys.length === 0) {
      // No local key. Either this identity already has one on another device
      // (a key is announced → wait for Key Transfer; generating would overwrite
      // the announcement and make the other device's messages undecryptable), or
      // it's brand-new for DM (nothing announced → generate + announce).
      if (remote) {
        await profileAsync(profile, 'db.setEncryptionPubkey', () =>
          setAccountEncryptionPubkey(pubkey, remote),
        );
        outcome = 'need-sync';
        return { kind: 'need_sync' };
      }
      const keypair = await profileAsync(profile, 'crypto.generateEncryptionKeypair', () =>
        generateEncryptionKeypair(pubkey),
      );
      await profileAsync(profile, 'db.setEncryptionPubkey', () =>
        setAccountEncryptionPubkey(pubkey, keypair.pubkey),
      );
      await profileAsync(profile, 'relay.publishKeyAnnouncement', () =>
        publishEncryptionKeyAnnouncement({
          signer,
          encryptionPubkey: keypair.pubkey,
          relays: keyAnnouncementRelays,
        }),
      );
      await profileAsync(profile, 'relay.savePublishDmRelays', () =>
        saveAndPublishDmRelays({ accountPubkey: pubkey, signer, relays: dmRelays }),
      );
    } else {
      // We hold at least one key. Sync is needed only when a NEWER key is
      // announced that we don't have at all. Otherwise we're current — or ahead
      // (we still hold the announced key as an older one, e.g. just after a local
      // rotation) — so (re)announce our current key to let the network catch up.
      const haveRemote = remote != null && keys.some((k) => k.pubkey === remote);
      if (remote && remote !== keys[0].pubkey && !haveRemote) {
        await profileAsync(profile, 'db.setEncryptionPubkey', () =>
          setAccountEncryptionPubkey(pubkey, remote),
        );
        outcome = 'need-sync';
        return { kind: 'need_sync' };
      }
      if (remote !== keys[0].pubkey) {
        await profileAsync(profile, 'db.setEncryptionPubkey', () =>
          setAccountEncryptionPubkey(pubkey, keys[0].pubkey),
        );
        await profileAsync(profile, 'relay.publishKeyAnnouncement', () =>
          publishEncryptionKeyAnnouncement({
            signer,
            encryptionPubkey: keys[0].pubkey,
            relays: keyAnnouncementRelays,
          }),
        );
      }
    }

    checkBootstrap(signal);
    onPhase('loading_messages');
    await profileAsync(profile, 'dm.init', () =>
      dmService.init({ accountPubkey: pubkey, dmRelays, metadata, abort: signal }),
    );
    checkBootstrap(signal);
    outcome = 'ready';
    return { kind: 'ready' };
  } catch (error) {
    if (error instanceof MessagingKeySyncRequiredError && !signal.aborted) {
      await setAccountEncryptionPubkey(pubkey, error.encryptionPubkey);
      return { kind: 'need_sync' };
    }
    throw error;
  } finally {
    profile?.end({ result: outcome });
  }
}

// Push the current bootstrap phase into the store so the boot screen can name
// what's happening. Defined once so every entry point reports the same way.
const reportPhase = (phase: BootPhase) => useActiveAccount.setState({ bootPhase: phase });

/** Minimum time the account-switch screen stays up, so its transition plays in
 * full even when the switch itself finishes in a few ms (no logo/screen flash).
 * A slower switch simply holds until it's actually done. */
const MIN_SWITCH_HOLD_MS = 600;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Pad the elapsed time up to `minMs` (no-op when the work already took longer). */
async function holdAtLeast(startedAt: number, minMs: number): Promise<void> {
  const remaining = minMs - (Date.now() - startedAt);
  if (remaining > 0) await wait(remaining);
}

/**
 * Bring `pubkey` online with the fastest correct path, shared by every entry
 * point (launch restore, sign-in, account switch). The caller has already
 * pointed storage at the account and set the initial boot phase.
 *
 * - **Fast path** (a usable encryption key is already on this device): go `ready`
 *   from local SQLite immediately and finish the network parts in the background
 *   ({@link backgroundSync}) — no boot screen wait. This is what makes switching
 *   to an established account feel instant.
 * - **Local creation**: persist the first key and queued configuration, show the
 *   account, then start subscriptions using that local metadata.
 * - **Slow path** (no local key yet — an imported account or a new device awaiting
 *   Key Transfer): nothing can be shown or decrypted until the network resolves
 *   which it is, so run the full {@link bootstrapAccount} behind the boot screen.
 */
async function comeOnline(pubkey: string, minHoldMs = 0): Promise<void> {
  const signal = beginBootstrap();
  beginMessagingSendPreparation(pubkey);
  configurationPublisher.start(pubkey);
  const profile = createPerfSpan('boot.comeOnline', { minHoldMs });
  let outcome = 'unknown';
  const startedAt = Date.now();
  try {
    const account = await profileAsync(profile, 'db.getAccount', () => getAccount(pubkey));
    checkBootstrap(signal);
    if (account?.signerType === 'generated' && account.localSetupPending) {
      const metadata = await profileAsync(profile, 'account.initializeLocally', () =>
        initializeGeneratedAccount(pubkey, signal),
      );
      checkBootstrap(signal);
      useActiveAccount.setState({
        activePubkey: pubkey, status: 'ready', bootPhase: null, switchingTo: null,
        syncTargetPubkey: null, error: null,
      });
      void backgroundSync(pubkey, signal, metadata);
      outcome = 'local-created';
      return;
    }
    const keys = await profileAsync(profile, 'db.loadEncryptionKeys', () =>
      loadEncryptionKeys(pubkey),
    );
    checkBootstrap(signal);
    if (keys.length > 0) {
      await profileAsync(profile, 'holdAtLeast', () => holdAtLeast(startedAt, minHoldMs));
      checkBootstrap(signal);
      useActiveAccount.setState({
        activePubkey: pubkey,
        status: 'ready',
        bootPhase: null,
        switchingTo: null,
        syncTargetPubkey: null,
        error: null,
      });
      void backgroundSync(pubkey, signal);
      outcome = 'fast-ready';
      return;
    }
    const result = await profileAsync(profile, 'bootstrapAccount', () =>
      bootstrapAccount(pubkey, reportPhase, signal),
    );
    await profileAsync(profile, 'holdAtLeast', () => holdAtLeast(startedAt, minHoldMs));
    checkBootstrap(signal);
    if (result.kind === 'need_sync') {
      failMessagingSendPreparation(
        pubkey,
        new Error('The current messaging encryption key must be synchronized before sending messages.'),
      );
      useActiveAccount.setState({
        activePubkey: null,
        status: 'need_sync',
        bootPhase: null,
        switchingTo: null,
        syncTargetPubkey: pubkey,
        error: null,
      });
      outcome = 'need-sync';
    } else {
      completeMessagingSendPreparation(pubkey);
      useActiveAccount.setState({
        activePubkey: pubkey,
        status: 'ready',
        bootPhase: null,
        switchingTo: null,
        syncTargetPubkey: null,
        error: null,
      });
      outcome = 'ready';
    }
  } catch (error) {
    // A cancelled local setup must not replace a newer session/sign-out with an error.
    if (!signal.aborted) {
      failMessagingSendPreparation(pubkey, error);
      throw error;
    }
  } finally {
    profile?.end({ result: outcome });
  }
}

/** Show persisted conversations immediately, but keep receiving disabled until
 * both routing metadata and the current encryption key have been reconciled. */
async function backgroundSync(pubkey: string, signal: AbortSignal, localMetadata?: MessagingMetadata): Promise<void> {
  const isCurrent = () => !signal.aborted && useActiveAccount.getState().activePubkey === pubkey;
  try {
    if (localMetadata) {
      // Let the new account paint before starting the live session. There is no
      // pre-creation history to fetch; later foreground entries resume normal sync.
      await wait(0);
      if (!isCurrent()) return;
      await dmService.init({
        accountPubkey: pubkey, dmRelays: localMetadata.dmRelays, metadata: localMetadata,
        abort: signal, skipInitialHistory: true,
      });
      if (isCurrent()) completeMessagingSendPreparation(pubkey);
      return;
    }
    const result = await bootstrapAccount(pubkey, () => {}, signal);
    if (!isCurrent()) return;
    if (result.kind === 'need_sync') {
      failMessagingSendPreparation(
        pubkey,
        new Error('The current messaging encryption key must be synchronized before sending messages.'),
      );
      useActiveAccount.setState({
        activePubkey: null,
        status: 'need_sync',
        syncTargetPubkey: pubkey,
        bootPhase: null,
      });
      return;
    }
    completeMessagingSendPreparation(pubkey);
    const account = await getAccount(pubkey);
    if (!isCurrent()) return;
    if (!account) throw new Error('Account not found');
    const signer = await createSigner({
      accountPubkey: pubkey,
      signerType: account.signerType,
      signerPayload: account.signerPayload,
    });
    const [keys, dmRelays, announcementRelays] = await Promise.all([
      loadEncryptionKeys(pubkey),
      loadAccountDmRelays(pubkey),
      ownKeyAnnouncementRelays(pubkey),
    ]);
    if (!isCurrent()) return;
    if (!keys[0]) throw new Error('No messaging encryption key is available.');
    await rotateEncryptionKeyIfDue({
      accountPubkey: pubkey, signer, dmRelays, announcementRelays, currentKey: keys[0],
    });
  } catch (error) {
    // Metadata unavailability retries inside preparation. Other failures keep
    // local conversations usable without starting intake from stale keys.
    if (isCurrent()) {
      if (dmService.getAccountPubkey() === pubkey) {
        completeMessagingSendPreparation(pubkey);
      } else {
        failMessagingSendPreparation(pubkey, error);
      }
      console.warn('[boot] Messaging preparation failed.', error);
    }
  }
}

export const useActiveAccount = create<State>((set, get) => ({
  activePubkey: null,
  status: 'idle',
  bootPhase: null,
  error: null,
  syncTargetPubkey: null,
  switchingTo: null,

  async loadFromStorage() {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading' });
    try {
      await migrateNip46BunkerSecrets();
      const pk = await getActiveAccountPubkey();
      if (!pk) {
        set({ activePubkey: null, status: 'ready' });
        return;
      }
      // The active-account pointer is ordinary SQLite state. Keep the backing-row
      // guard anyway so a damaged or partially restored database falls back to
      // onboarding instead of dead-ending on a missing account.
      if (!(await getAccount(pk))) {
        await clearActiveAccountPubkey();
        set({ activePubkey: null, status: 'ready' });
        return;
      }
      // The fast path (local key present) renders straight from SQLite; the slow
      // path (no key yet) keeps the branded boot screen (the generic "preparing"
      // step, via the root layout's fallback) until bootstrap reports its first
      // phase. `comeOnline` picks between them.
      await comeOnline(pk);
    } catch (e) {
      set({ status: 'error', bootPhase: null, error: (e as Error).message });
    }
  },

  async setActive(pubkey) {
    // Switching identities (this also serves the very first sign-in and adding a
    // second account): tear the whole session down before bringing the target
    // online. Relays especially must be closed — a socket already
    // NIP-42-authenticated as the previous account can't carry the new account's
    // reads or writes, so every connection has to be reopened and
    // re-authenticated as the new identity. Both destroys are no-ops on a first
    // sign-in (nothing is live yet).
    //
    // A switch (we already had an active account) shows the *target's* avatar +
    // name on a brief transition instead of the branded logo screen, held for a
    // minimum so it never just flashes. A first sign-in keeps the branded screen.
    const isSwitch = get().activePubkey != null && get().activePubkey !== pubkey;
    // Only an *established* account — one that already holds a local encryption key,
    // so it comes online instantly via the fast path — gets the avatar crossfade
    // overlay (and its minimum hold). A brand-new or freshly-imported account (no
    // local key yet) runs the full bootstrap, which takes a beat and has no
    // avatar/name to show, so it shows the branded "initializing account" boot
    // screen instead — identical to a first sign-in, so *creating* an account looks
    // the same whether it's launched from onboarding or from "Add account" in the
    // switcher. (Read keys before the teardown below — it doesn't touch relays.)
    const established = isSwitch && (await loadEncryptionKeys(pubkey)).length > 0;
    bootstrapAbort?.abort();
    cancelMessagingSendPreparation();
    configurationPublisher.stop();
    dmService.destroy();
    relayPool.destroy();
    // On a switch to an established account, keep the *old* `activePubkey` until the
    // new one is ready: the navigator stays mounted underneath while the switch
    // overlay (driven by `switchingTo`) fades over it, so there's no unmount/flash —
    // the transition crossfades in and out. A first sign-in / new account has no
    // prior account to crossfade from (already null), and shows the boot screen.
    set({
      status: 'loading',
      bootPhase: established ? 'signing_in' : 'initializing',
      error: null,
      syncTargetPubkey: null,
      switchingTo: established ? pubkey : null,
    });
    try {
      await setActiveAccountPubkey(pubkey);
      await comeOnline(pubkey, established ? MIN_SWITCH_HOLD_MS : 0);
    } catch (e) {
      set({ status: 'error', bootPhase: null, switchingTo: null, error: (e as Error).message });
    }
  },

  async signOut() {
    // Clear the durable pointer before changing the in-memory session so a
    // failed write cannot appear to sign out and then restore the account on
    // the next launch. Account rows and key material remain intact.
    await clearActiveAccountPubkey();
    bootstrapAbort?.abort();
    cancelMessagingSendPreparation();
    configurationPublisher.stop();
    dmService.destroy();
    relayPool.destroy();
    set({
      activePubkey: null,
      status: 'ready',
      bootPhase: null,
      error: null,
      syncTargetPubkey: null,
      switchingTo: null,
    });
  },

  async removeAccount(pubkey) {
    configurationPublisher.stop(pubkey);
    const wasActive = get().activePubkey === pubkey;
    if (wasActive) {
      // Stop producers before deleting their account-scoped rows. Session
      // invalidation is immediate; the wait covers only writes that had already
      // crossed an async boundary when the user confirmed removal.
      bootstrapAbort?.abort();
      cancelMessagingSendPreparation();
      const writesStopped = dmService.destroyAndWaitForWrites();
      relayPool.destroy();
      await writesStopped;
    }
    await removeAccountFromStore(pubkey);
    if (!wasActive) return;
    // Removing the account you're signed into returns you to onboarding (even when
    // other accounts remain on the device), rather than silently switching to one
    // of them. Sign into another from the login screen to switch to it. The `(app)`
    // guard redirects to /welcome once `activePubkey` is null.
    set({ activePubkey: null, status: 'ready', bootPhase: null, syncTargetPubkey: null, error: null });
  },

  /** Re-run bootstrap after a successful Key Transfer (local key now present). */
  async completeSync() {
    const pk = get().syncTargetPubkey;
    if (!pk) return;
    // Re-running bootstrap with a key now present: the boot screen shows the
    // generic "preparing" step (root-layout fallback) until bootstrap reports.
    set({ status: 'loading', bootPhase: null, error: null });
    beginMessagingSendPreparation(pk);
    const signal = beginBootstrap();
    try {
      const result = await bootstrapAccount(pk, reportPhase, signal);
      checkBootstrap(signal);
      if (result.kind === 'need_sync') {
        failMessagingSendPreparation(
          pk,
          new Error('The current messaging encryption key must be synchronized before sending messages.'),
        );
        set({ status: 'need_sync', bootPhase: null });
        return;
      }
      completeMessagingSendPreparation(pk);
      set({ activePubkey: pk, status: 'ready', bootPhase: null, syncTargetPubkey: null });
    } catch (e) {
      if (!signal.aborted) {
        failMessagingSendPreparation(pk, e);
        set({ status: 'error', bootPhase: null, error: (e as Error).message });
      }
    }
  },

  async requireResync(newEncryptionPubkey) {
    const pk = get().activePubkey;
    if (!pk) return;
    bootstrapAbort?.abort();
    failMessagingSendPreparation(
      pk,
      new Error('The current messaging encryption key must be synchronized before sending messages.'),
    );
    dmService.destroy();
    // Keep all local keys — they're still needed to decrypt history, and the
    // single key list never drops them. We just record the newer announced key
    // and gate on Key Transfer: bootstrap sees keys[0] ≠ announcement and stays
    // in need_sync until the new key is imported (prepended).
    await setAccountEncryptionPubkey(pk, newEncryptionPubkey);
    set({ activePubkey: null, status: 'need_sync', syncTargetPubkey: pk });
  },

  async resetEncryptionKey() {
    const pk = get().activePubkey;
    if (!pk) return;
    const account = await getAccount(pk);
    if (!account) throw new Error('Account not found');
    const signer = await createSigner({
      accountPubkey: pk,
      signerType: account.signerType,
      signerPayload: account.signerPayload,
    });
    const dmRelays = await loadAccountDmRelays(pk);
    await rotateEncryptionKey({
      accountPubkey: pk,
      signer,
      dmRelays,
      announcementRelays: await ownKeyAnnouncementRelays(pk),
    });
  },

}));
