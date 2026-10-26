import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
/** Public signed events shared by every application and account. */
export const localRelayEvents = sqliteTable('local_relay_events', {
    id: text('id').primaryKey(), pubkey: text('pubkey').notNull(), kind: integer('kind').notNull(),
    createdAt: integer('created_at').notNull(), coordinate: text('coordinate'), expiresAt: integer('expires_at'),
    storedAt: integer('stored_at').notNull(), bytes: integer('bytes').notNull(), event: text('event').notNull(),
}, t => [uniqueIndex('local_relay_coordinate').on(t.coordinate), index('local_relay_time').on(t.createdAt, t.id),
    index('local_relay_author_time').on(t.pubkey, t.createdAt, t.id), index('local_relay_kind_time').on(t.kind, t.createdAt, t.id),
    index('local_relay_author_kind_time').on(t.pubkey, t.kind, t.createdAt, t.id), index('local_relay_eviction').on(t.storedAt, t.id)]);
export const localRelayTags = sqliteTable('local_relay_tags', {
    eventId: text('event_id').notNull().references(() => localRelayEvents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), value: text('value').notNull(),
}, t => [primaryKey({ columns: [t.eventId, t.name, t.value] }), index('local_relay_tag_lookup').on(t.name, t.value, t.eventId)]);
export const localRelayStats = sqliteTable('local_relay_stats', {
    id: integer('id').primaryKey(), events: integer('events').notNull(), bytes: integer('bytes').notNull(),
});
