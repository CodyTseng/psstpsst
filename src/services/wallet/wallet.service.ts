import { vaultAccess } from '@/platform/vault-access';
import type { ImportedWallet, WalletOperation } from '@/platform/ports/key-vault';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  type Event,
  type EventTemplate,
} from 'nostr-tools';

import { db } from '@/db/client';
import { wallets, walletTransactions } from '@/db/schema';
import { walletDescriptionText } from '@/lib/wallet/description';
import { platform } from '@/platform';
import { relayPool } from '@/services/relay/relay-pool';
import { parseBolt11Invoice } from '@/services/wallet/bolt11';


const NWC_RESPONSE_KIND = 23195;
const REQUEST_TIMEOUT_MS = 60000;
const MIN_REQUEST_GAP_MS = 900;
const RATE_LIMIT_BACKOFF_MS = 2500;

export type WalletRow = typeof wallets.$inferSelect;
export type WalletTransactionRow = typeof walletTransactions.$inferSelect;

export type NwcErrorKind =
  | 'invalid_connection'
  | 'missing_secret'
  | 'wallet_offline'
  | 'permission_denied'
  | 'not_supported'
  | 'rate_limited'
  | 'payment_failed'
  | 'authentication_failed'
  | 'authentication_unavailable'
  | 'timeout'
  | 'unknown';

export class WalletError extends Error {
  constructor(
    readonly kind: NwcErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
  }
}

type NwcResponse<T> = {
  result_type?: string;
  result?: T;
  error?: { code?: string; message?: string };
};

type NwcInfo = {
  alias?: string;
  name?: string;
  lud16?: string;
  methods?: string[];
  notifications?: string[];
  budget?: unknown;
};

type NwcTransaction = {
  type?: string;
  state?: string;
  invoice?: string;
  description?: unknown;
  description_hash?: string;
  metadata?: unknown;
  payment_hash?: string;
  preimage?: string;
  amount?: number;
  amount_msat?: number;
  fees_paid?: number;
  fees_paid_msat?: number;
  created_at?: number;
  expires_at?: number;
  settled_at?: number;
};

export async function addWallet(accountPubkey: string, connectionString: string): Promise<WalletRow> {
  validateWalletConnectionString(connectionString);
  const confirmation = walletConsent();
  if (!await platform.security.ensureWalletProtection(accountPubkey, confirmation)) throw new WalletError('authentication_failed');
  const importing = vaultAccess.execute({ method: 'walletImport', account: accountPubkey, connectionString });
  connectionString = '';
  const imported = await importing as { id: string; walletPubkey: string; relays: string[] };
  return registerImportedWallet(accountPubkey, imported);
}

async function registerImportedWallet(accountPubkey: string, imported: ImportedWallet): Promise<WalletRow> {
  try {
    const now = nowSec(), relays = imported.relays, walletId = imported.id;
    const existingWallets = await getWallets(accountPubkey);
    const sortOrder = existingWallets.reduce((max, wallet) => Math.max(max, wallet.sortOrder), -1) + 1;
    const info = await requestNwc<NwcInfo>({ id: walletId, accountPubkey, walletPubkey: imported.walletPubkey, relaysJson: JSON.stringify(relays) }, 'get_info', {}).catch(() => null);

    const name = info?.alias || info?.name || shortPubkey(imported.walletPubkey);
    const displayName = nextAvailableWalletName(existingWallets, name);
    const row = {
      id: walletId,
      accountPubkey,
      walletPubkey: imported.walletPubkey,
      relaysJson: JSON.stringify(relays),
      name,
      customName: displayName,
      lud16: info?.lud16 ?? null,
      capabilitiesJson: info?.methods ? JSON.stringify(info.methods) : null,
      notificationsJson: info?.notifications ? JSON.stringify(info.notifications) : null,
      budgetJson: info?.budget ? JSON.stringify(info.budget) : null,
      balanceMsat: null,
      isDefault: true,
      sortOrder,
      connectedAt: now,
      updatedAt: now,
      lastSyncAt: info ? now : null,
    };

    await db.transaction(async (tx) => {
      await tx
        .update(wallets)
        .set({ isDefault: false })
        .where(eq(wallets.accountPubkey, accountPubkey))
        .run();
      await tx.insert(wallets).values(row).run();
    });
    return row;
  } catch (error) {
    await vaultAccess.execute({ method: 'walletRemove', account: accountPubkey, walletId: imported.id }).catch(() => {});
    throw error;
  }
}

export function getWallets(accountPubkey: string): Promise<WalletRow[]> {
  return db
    .select()
    .from(wallets)
    .where(eq(wallets.accountPubkey, accountPubkey))
    .orderBy(asc(wallets.sortOrder))
    .all();
}

/**
 * Persist a new wallet order for one account. Selecting the active wallet does
 * not touch this column, so the picker stays stable across wallet switches.
 */
export async function reorderWallets(accountPubkey: string, walletIdsInOrder: string[]): Promise<void> {
  for (let i = 0; i < walletIdsInOrder.length; i++) {
    await db
      .update(wallets)
      .set({ sortOrder: i, updatedAt: nowSec() })
      .where(and(eq(wallets.accountPubkey, accountPubkey), eq(wallets.id, walletIdsInOrder[i])));
  }
}

export async function getDefaultWallet(accountPubkey: string): Promise<WalletRow | null> {
  return (
    (await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.accountPubkey, accountPubkey), eq(wallets.isDefault, true)))
      .limit(1)
      .get()) ?? null
  );
}

export async function setDefaultWallet(accountPubkey: string, walletId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(wallets)
      .set({ isDefault: false })
      .where(eq(wallets.accountPubkey, accountPubkey))
      .run();
    await tx
      .update(wallets)
      .set({ isDefault: true, updatedAt: nowSec() })
      .where(and(eq(wallets.accountPubkey, accountPubkey), eq(wallets.id, walletId)))
      .run();
  });
}

export async function removeWallet(accountPubkey: string, walletId: string): Promise<void> {
  const wasDefault =
    (await db
      .select({ isDefault: wallets.isDefault })
      .from(wallets)
      .where(and(eq(wallets.accountPubkey, accountPubkey), eq(wallets.id, walletId)))
      .limit(1)
      .get())?.isDefault ?? false;

  await db
    .delete(wallets)
    .where(and(eq(wallets.accountPubkey, accountPubkey), eq(wallets.id, walletId)))
    .run();
  await vaultAccess.execute({ method: 'walletRemove', account: accountPubkey, walletId });

  if (!wasDefault) return;
  const next = (await getWallets(accountPubkey))[0];
  if (next) await setDefaultWallet(accountPubkey, next.id);
}

export async function renameWallet(
  accountPubkey: string,
  walletId: string,
  customName: string,
): Promise<void> {
  await db
    .update(wallets)
    .set({ customName: customName.trim() || null, updatedAt: nowSec() })
    .where(and(eq(wallets.accountPubkey, accountPubkey), eq(wallets.id, walletId)))
    .run();
}

function nextAvailableWalletName(existingWallets: WalletRow[], baseName: string): string {
  const existing = existingWallets.map((wallet) => wallet.customName || wallet.name);
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = new RegExp(`^${escaped} (\\d+)$`);
  let max = 0;
  existing.forEach((name) => {
    if (name === baseName) {
      max = Math.max(max, 1);
      return;
    }
    const match = name.match(suffix);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return max === 0 ? baseName : `${baseName} ${max + 1}`;
}

type WalletRefreshResult = { balanceMsat: number | null };

const inFlightWalletRefreshes = new Map<string, Promise<WalletRefreshResult>>();

export function refreshWallet(wallet: WalletRow): Promise<WalletRefreshResult> {
  const existing = inFlightWalletRefreshes.get(wallet.id);
  if (existing) return existing;

  const refresh = refreshWalletNow(wallet);
  inFlightWalletRefreshes.set(wallet.id, refresh);
  refresh.finally(() => {
    if (inFlightWalletRefreshes.get(wallet.id) === refresh) inFlightWalletRefreshes.delete(wallet.id);
  }).catch(() => {});
  return refresh;
}

async function refreshWalletNow(wallet: WalletRow): Promise<WalletRefreshResult> {
  const info = await callWalletWithRetry<NwcInfo>(wallet, 'get_info', {}).catch(() => null);
  const balance = await callWalletWithRetry<{ balance?: number; balance_msat?: number }>(
    wallet,
    'get_balance',
    {},
  );
  const transactions = await callWalletWithRetry<{ transactions?: NwcTransaction[] }>(wallet, 'list_transactions', {
      limit: 30,
      unpaid: true,
    }).catch(() => ({ transactions: [] }));

  const now = nowSec();
  const balanceMsat = balance.balance_msat ?? balance.balance ?? null;
  await db
    .update(wallets)
    .set({
      name: info?.alias || info?.name || wallet.name,
      lud16: info?.lud16 ?? wallet.lud16,
      capabilitiesJson: info?.methods ? JSON.stringify(info.methods) : wallet.capabilitiesJson,
      notificationsJson: info?.notifications ? JSON.stringify(info.notifications) : wallet.notificationsJson,
      budgetJson: info?.budget ? JSON.stringify(info.budget) : wallet.budgetJson,
      balanceMsat,
      lastSyncAt: now,
      updatedAt: now,
    })
    .where(eq(wallets.id, wallet.id))
    .run();

  await cacheTransactions(wallet, transactions.transactions ?? []);
  return { balanceMsat };
}

export async function payInvoice(
  wallet: WalletRow,
  invoice: string,
  _authCopy: { prompt: string; cancel: string },
  metadata?: Record<string, unknown>,
  guard?: WalletRequestGuard,
): Promise<unknown> {
  guard?.check();
  return callWallet(wallet, 'pay_invoice', metadata ? { invoice, metadata } : { invoice }, guard);
}

export async function makeInvoice(
  wallet: WalletRow,
  params: { amountMsat: number; description?: string },
  guard?: WalletRequestGuard,
): Promise<{ invoice?: string; payment_request?: string; payment_hash?: string; state?: string; settled_at?: number; preimage?: string }> {
  return callWallet(wallet, 'make_invoice', {
    amount: params.amountMsat,
    description: params.description ?? '',
  }, guard);
}

export async function lookupInvoiceStatus(
  wallet: WalletRow,
  params: { invoice: string; paymentHash?: string | null },
): Promise<'pending' | 'settled' | 'expired' | 'unknown'> {
  const tx = walletSupportsMethod(wallet, 'lookup_invoice')
    ? await callWalletWithRetry<NwcTransaction>(
        wallet,
        'lookup_invoice',
        params.paymentHash ? { payment_hash: params.paymentHash } : { invoice: params.invoice },
      ).catch(() => null)
    : await findInvoiceInTransactions(wallet, params);

  if (!tx) return 'unknown';
  return invoiceState(tx);
}

export async function cacheLocalInvoiceTransaction(
  wallet: WalletRow,
  params: {
    invoice: string;
    type: 'incoming' | 'outgoing';
    state?: string;
    paymentHash?: string | null;
    preimage?: string | null;
    amountMsat?: number | null;
    description?: string | null;
    createdAt?: number | null;
    expiresAt?: number | null;
    settledAt?: number | null;
    raw?: Record<string, unknown>;
  },
): Promise<WalletTransactionRow> {
  const now = nowSec();
  const parsed = parseBolt11Invoice(params.invoice);
  const paymentHash = params.paymentHash ?? parsed.paymentHash;
  const row: WalletTransactionRow = {
    id: localInvoiceTransactionId(wallet.id, parsed.invoice, paymentHash),
    walletId: wallet.id,
    accountPubkey: wallet.accountPubkey,
    type: params.type,
    state: params.state ?? (params.settledAt || params.preimage ? 'settled' : 'pending'),
    invoice: parsed.invoice,
    description: walletDescriptionText(params.description) ?? parsed.description,
    paymentHash,
    preimage: params.preimage ?? null,
    amountMsat: params.amountMsat ?? parsed.amountMsat,
    feesPaidMsat: null,
    createdAt: params.createdAt ?? parsed.createdAt ?? now,
    expiresAt: params.expiresAt ?? parsed.expiresAt,
    settledAt: params.settledAt ?? null,
    rawJson: JSON.stringify(params.raw ?? { source: 'local_invoice', invoice: parsed.invoice }),
    updatedAt: now,
  };

  await db
    .insert(walletTransactions)
    .values(row)
    .onConflictDoUpdate({
      target: walletTransactions.id,
      set: {
        type: row.type,
        state: row.state,
        invoice: row.invoice,
        description: row.description,
        paymentHash: row.paymentHash,
        preimage: row.preimage,
        amountMsat: row.amountMsat,
        expiresAt: row.expiresAt,
        settledAt: row.settledAt,
        rawJson: row.rawJson,
        updatedAt: row.updatedAt,
      },
    })
    .run();
  return row;
}

/**
 * Best-effort variant for background status refreshes. Interactive payment
 * paths should call and await `cacheLocalInvoiceTransaction` so persistence
 * failures still reach their existing error handling.
 */
export async function tryCacheLocalInvoiceTransaction(
  wallet: WalletRow,
  params: Parameters<typeof cacheLocalInvoiceTransaction>[1],
): Promise<void> {
  try {
    await cacheLocalInvoiceTransaction(wallet, params);
  } catch (error) {
    console.warn('[wallet] Failed to cache invoice transaction.', error);
  }
}

export function walletSupportsMethod(wallet: Pick<WalletRow, 'capabilitiesJson'>, method: string): boolean {
  const methods = parseJson<string[] | null>(wallet.capabilitiesJson, null);
  return methods == null || methods.includes(method);
}

async function findInvoiceInTransactions(
  wallet: WalletRow,
  params: { invoice: string; paymentHash?: string | null },
): Promise<NwcTransaction | null> {
  const res = await callWalletWithRetry<{ transactions?: NwcTransaction[] }>(wallet, 'list_transactions', {
    limit: 20,
    unpaid: true,
    type: 'incoming',
  }).catch(() => ({ transactions: [] }));
  return (
    res.transactions?.find((tx) =>
      params.paymentHash ? tx.payment_hash === params.paymentHash : tx.invoice === params.invoice,
    ) ?? null
  );
}

function invoiceState(tx: NwcTransaction): 'pending' | 'settled' | 'expired' | 'unknown' {
  if (tx.state === 'settled' || tx.settled_at || tx.preimage) return 'settled';
  if (tx.state === 'expired') return 'expired';
  if (tx.state === 'pending' || tx.state === 'accepted') return 'pending';
  return 'unknown';
}

function localInvoiceTransactionId(
  walletId: string,
  invoice: string,
  paymentHash: string | null,
): string {
  return paymentHash ? `${walletId}:${paymentHash}` : `${walletId}:invoice:${invoice.slice(0, 48)}`;
}

export function getCachedTransactions(walletId: string): Promise<WalletTransactionRow[]> {
  return db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.walletId, walletId))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(30)
    .all();
}

export type WalletRequestGuard = { check: () => void; beforeSend?: () => Promise<void> };

async function callWallet<T>(wallet: WalletRow, method: WalletOperation, params: Record<string, unknown>, guard?: WalletRequestGuard): Promise<T> {
  return enqueueWalletRequest(wallet.id, async () => {
    guard?.check();
    return requestNwc<T>(wallet, method, params, guard);
  });
}

async function callWalletWithRetry<T>(
  wallet: WalletRow,
  method: WalletOperation,
  params: Record<string, unknown>,
): Promise<T> {
  try {
    return await callWallet<T>(wallet, method, params);
  } catch (err) {
    if (
      !(err instanceof WalletError) ||
      (err.kind !== 'timeout' && err.kind !== 'wallet_offline' && err.kind !== 'rate_limited')
    ) {
      throw err;
    }
    if (err.kind === 'rate_limited') await delay(RATE_LIMIT_BACKOFF_MS);
    return callWallet<T>(wallet, method, params);
  }
}

function walletConsent(): { language: string } {
  // Load only for interactive wallet work; headless consumers do not initialize i18n.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { language: (require('@/i18n/core') as typeof import('@/i18n/core')).default.language };
}

async function requestNwc<T>(
  wallet: Pick<WalletRow, 'id' | 'accountPubkey' | 'walletPubkey' | 'relaysJson'>,
  method: WalletOperation,
  params: Record<string, unknown>,
  guard?: WalletRequestGuard,
): Promise<T> {
  guard?.check();
  const confirmation = walletConsent();
  guard?.check();
  let prepared: { event: Event; peer: string; relays: string[] };
  try {
    prepared = await vaultAccess.execute({ method: 'walletRequest', account: wallet.accountPubkey, walletId: wallet.id,
      operation: method, params, confirmation }) as typeof prepared;
  } catch { throw new WalletError(method === 'pay_invoice' ? 'authentication_failed' : 'missing_secret'); }
  guard?.check();
  await guard?.beforeSend?.();
  guard?.check();
  const response = await waitForNwcResponse<T>(wallet, method, prepared.peer, prepared.relays, prepared.event);
  if (response.error) throw mapNwcError(response.error);
  if (!response.result) return {} as T;
  return response.result;
}

function waitForNwcResponse<T>(
  wallet: Pick<WalletRow, 'id' | 'accountPubkey'>,
  method: WalletOperation,
  walletPubkey: string,
  relays: string[],
  request: Event,
): Promise<NwcResponse<T>> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      fn();
    };

    const unsubscribe = relayPool.subscribe({
      relays,
      filter: {
        kinds: [NWC_RESPONSE_KIND],
        authors: [walletPubkey],
        '#e': [request.id],
        since: nowSec() - 5,
      },
      signAuth: (authEvt) => signWalletRelayAuth(wallet, authEvt),
      onEvent: async (event) => {
        try {
          const response = await vaultAccess.execute({ method: 'walletReceive', account: wallet.accountPubkey, walletId: wallet.id, requestId: request.id, event }) as NwcResponse<T> | null;
          if (response) finish(() => resolve(response));
        } catch {
        }
      },
    });

    let allPublishFailed = false;
    let rateLimited = false;
    void relayPool
      .publishEvent({
        relays,
        event: request,
        timeoutMs: 6000,
        signAuth: (authEvt) => signWalletRelayAuth(wallet, authEvt),
      })
      .then(
        (results) => {
          allPublishFailed = results.every((r) => !r.outcome.ok);
          rateLimited = results.some(
            (r) => !r.outcome.ok && isRateLimitedReason(r.outcome.reason),
          );
        },
        () => {
          allPublishFailed = true;
        },
      );

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new WalletError(rateLimited ? 'rate_limited' : allPublishFailed ? 'wallet_offline' : 'timeout'),
        ),
      );
    }, REQUEST_TIMEOUT_MS);
  });
}

async function signWalletRelayAuth(wallet: Pick<WalletRow, 'id' | 'accountPubkey'>, template: EventTemplate): Promise<Event> {
  return await vaultAccess.execute({ method: 'walletRelayAuth', account: wallet.accountPubkey, walletId: wallet.id, template }) as Event;
}

/** Validate the user-supplied text without decoding its private key into business memory. */
export function validateWalletConnectionString(connectionString: string): void {
  try {
    const uri = new URL(connectionString.trim());
    if (uri.protocol !== 'nostr+walletconnect:' || !/^[0-9a-f]{64}$/i.test(uri.hostname) || !uri.searchParams.has('secret') || !uri.searchParams.getAll('relay').length) throw new Error('invalid');
  } catch { throw new WalletError('invalid_connection'); }
}

async function cacheTransactions(wallet: WalletRow, txs: NwcTransaction[]): Promise<void> {
  const now = nowSec();
  const paramsBatch = txs.map((tx, index) => {
    const paymentHash = tx.payment_hash ?? null;
    const id = paymentHash
      ? `${wallet.id}:${paymentHash}`
      : `${wallet.id}:${tx.created_at ?? now}:${index}`;
    return [
      id,
      wallet.id,
      wallet.accountPubkey,
      tx.type ?? 'unknown',
      tx.state ?? 'unknown',
      tx.invoice ?? null,
      transactionDescription(tx),
      paymentHash,
      tx.preimage ?? null,
      tx.amount_msat ?? tx.amount ?? null,
      tx.fees_paid_msat ?? tx.fees_paid ?? null,
      tx.created_at ?? now,
      tx.expires_at ?? null,
      tx.settled_at ?? null,
      JSON.stringify(tx),
      now,
    ];
  });
  await platform.database.runBatch(
    `INSERT OR REPLACE INTO wallet_transactions
      (id, wallet_id, account_pubkey, type, state, invoice, description, payment_hash, preimage,
       amount_msat, fees_paid_msat, created_at, expires_at, settled_at, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    paramsBatch,
  );
}

function transactionDescription(tx: NwcTransaction): string | null {
  return walletDescriptionText(tx.description) ?? walletDescriptionText(tx.metadata) ?? invoiceDescription(tx.invoice);
}

function invoiceDescription(invoice: string | undefined): string | null {
  if (!invoice) return null;
  try {
    return parseBolt11Invoice(invoice).description;
  } catch {
    return null;
  }
}

function mapNwcError(error: { code?: string; message?: string }): WalletError {
  const code = (error.code ?? '').toUpperCase();
  if (code.includes('NOT_IMPLEMENTED')) {
    return new WalletError('not_supported', error.message);
  }
  if (code.includes('UNAUTHORIZED') || code.includes('FORBIDDEN') || code.includes('RESTRICTED')) {
    return new WalletError('permission_denied', error.message);
  }
  if (code.includes('PAYMENT') || code.includes('INSUFFICIENT') || code.includes('INVOICE')) {
    return new WalletError('payment_failed', error.message);
  }
  return new WalletError('unknown', error.message);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

const requestQueues = new Map<string, Promise<unknown>>();
const lastRequestAt = new Map<string, number>();

function enqueueWalletRequest<T>(walletId: string, task: () => Promise<T>): Promise<T> {
  const prev = requestQueues.get(walletId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const elapsed = Date.now() - (lastRequestAt.get(walletId) ?? 0);
      if (elapsed < MIN_REQUEST_GAP_MS) await delay(MIN_REQUEST_GAP_MS - elapsed);
      lastRequestAt.set(walletId, Date.now());
      return task();
    });
  requestQueues.set(walletId, next);
  next.finally(() => {
    if (requestQueues.get(walletId) === next) requestQueues.delete(walletId);
  }).catch(() => {});
  return next;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitedReason(reason: string): boolean {
  return reason.toLowerCase().includes('rate');
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
