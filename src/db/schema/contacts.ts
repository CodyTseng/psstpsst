import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

/**
 * The account's saved contacts. Decoupled from conversations on purpose: a
 * contact survives deleting its conversation, and a contact can be added before
 * any message is exchanged. The local table is the UI source of truth; it is
 * synced privately across the user's own devices via a NIP-51 follow set
 * (kind 30000, `d=psstpsst-contacts`) whose entries are NIP-44-encrypted to self.
 */
export const contacts = sqliteTable(
  'contacts',
  {
    accountPubkey: text('account_pubkey').notNull(),
    pubkey: text('pubkey').notNull(),
    addedAt: integer('added_at').notNull(),
    /** `manual` = added via the contacts UI; `auto` = first reply to a DM. */
    source: text('source', { enum: ['manual', 'auto'] }).notNull().default('manual'),
    /** Local nickname set by the user — synced via the NIP-51 p-tag petname
     * slot (`["p", pubkey, relay, petname]`). Null when unset. */
    petname: text('petname'),
  },
  (t) => [
    primaryKey({ columns: [t.accountPubkey, t.pubkey] }),
    index('idx_contacts_account').on(t.accountPubkey),
  ],
);
