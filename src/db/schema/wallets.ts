import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { accounts } from './accounts';

export const wallets = sqliteTable(
  'wallets',
  {
    id: text('id').primaryKey(),
    accountPubkey: text('account_pubkey')
      .notNull()
      .references(() => accounts.pubkey, { onDelete: 'cascade' }),
    walletPubkey: text('wallet_pubkey').notNull(),
    relaysJson: text('relays_json').notNull(),
    name: text('name').notNull(),
    customName: text('custom_name'),
    lud16: text('lud16'),
    capabilitiesJson: text('capabilities_json'),
    notificationsJson: text('notifications_json'),
    budgetJson: text('budget_json'),
    balanceMsat: integer('balance_msat'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    /** Manual list position (ascending). Selecting a wallet only flips
     * `isDefault`; it never reshuffles the management list. */
    sortOrder: integer('sort_order').notNull().default(0),
    connectedAt: integer('connected_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastSyncAt: integer('last_sync_at'),
  },
  (t) => [
    index('idx_wallets_account').on(t.accountPubkey),
    index('idx_wallets_account_sort').on(t.accountPubkey, t.sortOrder),
    uniqueIndex('idx_wallets_one_default')
      .on(t.accountPubkey, t.isDefault)
      .where(sql`${t.isDefault} = true`),
  ],
);

export const walletTransactions = sqliteTable(
  'wallet_transactions',
  {
    id: text('id').primaryKey(),
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    accountPubkey: text('account_pubkey')
      .notNull()
      .references(() => accounts.pubkey, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    state: text('state').notNull(),
    invoice: text('invoice'),
    description: text('description'),
    paymentHash: text('payment_hash'),
    preimage: text('preimage'),
    amountMsat: integer('amount_msat'),
    feesPaidMsat: integer('fees_paid_msat'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    settledAt: integer('settled_at'),
    rawJson: text('raw_json').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_wallet_transactions_wallet_created').on(t.walletId, t.createdAt),
    index('idx_wallet_transactions_account').on(t.accountPubkey),
    index('idx_wallet_transactions_account_invoice').on(t.accountPubkey, t.invoice),
  ],
);
