import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts';

/** Account-wide replay protection survives wallet removal and application-data resets. */
export const webLnPayments = sqliteTable('webln_payments', {
  accountPubkey: text('account_pubkey').notNull().references(() => accounts.pubkey, { onDelete: 'cascade' }),
  paymentHash: text('payment_hash').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [primaryKey({ columns: [t.accountPubkey, t.paymentHash] })]);
