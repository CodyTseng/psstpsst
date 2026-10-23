import { matchFilters, verifyEvent, type Event, type Filter } from 'nostr-tools';
import { isSignedEvent } from '@/lib/nostr/event-validation';
import type { SqliteExecutor, SqlBindValue } from '@/platform/ports/database';
import { localFilters, filterSql } from './filters';
const MAX_EVENTS = 100000, MAX_BYTES = 128 * 1024 * 1024;
const privateKinds = new Set([4, 13, 14, 15, 1059]);
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export function eventCoordinate(event: Pick<Event, 'kind' | 'pubkey' | 'tags'>): string | null {
    if (event.kind >= 30000 && event.kind < 40000)
        return `${event.kind}:${event.pubkey}:${event.tags.find(tag => tag[0] === 'd')?.[1] ?? ''}`;
    if (event.kind === 0 || event.kind === 3 || event.kind >= 10000 && event.kind < 20000)
        return `${event.kind}:${event.pubkey}:`;
    return null;
}
async function rows<T>(executor: SqliteExecutor, sql: string, params: SqlBindValue[] = [], columns: string[] = []): Promise<T[]> {
    const values = (await executor.execute(sql, params, 'all')).rows as unknown[][];
    return values.map(row => Object.fromEntries(columns.map((name, index) => [name, row[index]])) as T);
}
/** In-process public-event relay. Persistence never contains account ownership or private chat rows. */
export class LocalRelay {
    private writes: Promise<unknown> = Promise.resolve();
    private listeners = new Set<{
        filters: Filter[];
        event: (event: Event) => void;
    }>();
    constructor(private database: SqliteExecutor, private verify: (event: Event) => boolean | Promise<boolean> = verifyEvent) { }
    private write<T>(work: () => Promise<T>): Promise<T> {
        const result = this.writes.catch(() => { }).then(work);
        this.writes = result;
        return result;
    }
    async add(input: unknown): Promise<boolean> {
        // JSON cloning strips nostr-tools' cached verification symbol and freezes the submitted snapshot.
        let event: Event;
        try {
            const raw = JSON.stringify(input);
            if (!raw)
                throw new Error();
            event = JSON.parse(raw);
        }
        catch {
            throw new Error('invalid-event');
        }
        if (!isSignedEvent(event))
            throw new Error('invalid-event');
        if (privateKinds.has(event.kind))
            throw new Error('private-event');
        await yieldTask();
        if (!await this.verify(event))
            throw new Error('invalid-signature');
        const expiration = event.tags.find(tag => tag[0] === 'expiration')?.[1];
        const expiresAt = expiration && /^\d+$/.test(expiration) && Number.isSafeInteger(Number(expiration)) ? Number(expiration) : null;
        if (expiresAt !== null && expiresAt <= Date.now() / 1000)
            return false;
        return this.write(async () => {
            let accepted = true;
            if (event.kind < 20000 || event.kind >= 30000)
                accepted = await this.database.transaction(async (tx) => {
                    if ((await rows(tx, 'SELECT id FROM local_relay_events WHERE id=?', [event.id])).length)
                        return false;
                    const coordinate = eventCoordinate(event);
                    if (coordinate !== null) {
                        const prior = (await rows<{
                            id: string;
                            created_at: number;
                        }>(tx, 'SELECT id,created_at FROM local_relay_events WHERE coordinate=?', [coordinate], ['id', 'created_at']))[0];
                        if (prior && (prior.created_at > event.created_at || prior.created_at === event.created_at && prior.id < event.id))
                            return false;
                        if (prior)
                            await tx.execute('DELETE FROM local_relay_events WHERE id=?', [prior.id], 'run');
                    }
                    const raw = JSON.stringify(event), bytes = new TextEncoder().encode(raw).length;
                    await tx.execute('INSERT INTO local_relay_events(id,pubkey,kind,created_at,coordinate,expires_at,stored_at,bytes,event) VALUES(?,?,?,?,?,?,?,?,?)', [event.id, event.pubkey, event.kind, event.created_at, coordinate, expiresAt, Date.now(), bytes, raw], 'run');
                    const tags = new Map<string, string[]>();
                    for (const tag of event.tags)
                        if (/^[a-zA-Z]$/.test(tag[0]) && tag.length >= 2)
                            tags.set(JSON.stringify([tag[0], tag[1]]), tag);
                    const values = [...tags.values()];
                    for (let offset = 0; offset < values.length; offset += 100) {
                        const batch = values.slice(offset, offset + 100);
                        await tx.execute(`INSERT INTO local_relay_tags(event_id,name,value) VALUES ${batch.map(() => '(?,?,?)').join(',')}`, batch.flatMap(tag => [event.id, tag[0], tag[1]]), 'run');
                    }
                    for (;;) {
                        const stats = (await rows<{
                            events: number;
                            bytes: number;
                        }>(tx, 'SELECT events,bytes FROM local_relay_stats WHERE id=1', [], ['events', 'bytes']))[0];
                        if (stats.events <= MAX_EVENTS && stats.bytes <= MAX_BYTES)
                            break;
                        await tx.execute('DELETE FROM local_relay_events WHERE id IN (SELECT id FROM local_relay_events ORDER BY stored_at,id LIMIT 256)', [], 'run');
                    }
                    return true;
                });
            if (accepted)
                for (const listener of this.listeners)
                    if (matchFilters(listener.filters, event)) {
                        try {
                            listener.event(JSON.parse(JSON.stringify(event)));
                        }
                        catch { /* One consumer must not interrupt others. */ }
                    }
            return accepted;
        });
    }
    async query(input: unknown): Promise<Event[]> {
        const filters = localFilters(input);
        type Candidate = {
            id: string;
            created_at: number;
            bytes: number;
        };
        const candidates = new Map<string, Candidate>();
        for (const filter of filters) {
            const where = filterSql(filter);
            const found = await rows<Candidate>(this.database, `SELECT id,created_at,bytes FROM local_relay_events WHERE ${where.sql} ORDER BY created_at DESC,id LIMIT ?`, [...where.params, filter.limit ?? 100], ['id', 'created_at', 'bytes']);
            for (const row of found)
                candidates.set(row.id, row);
        }
        const selected: string[] = [];
        let bytes = 0;
        for (const row of [...candidates.values()].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))) {
            if (selected.length >= 1000 || bytes + row.bytes > 2 * 1024 * 1024)
                break;
            bytes += row.bytes;
            selected.push(row.id);
        }
        const events = new Map<string, Event>();
        for (let offset = 0; offset < selected.length; offset += 32) {
            const ids = selected.slice(offset, offset + 32);
            const found = await rows<{
                id: string;
                event: string;
            }>(this.database, `SELECT id,event FROM local_relay_events WHERE id IN (${ids.map(() => '?').join(',')})`, ids, ['id', 'event']);
            for (let index = 0; index < found.length; index++) {
                if (index % 8 === 0)
                    await yieldTask();
                const row = found[index];
                events.set(row.id, JSON.parse(row.event));
            }
        }
        return selected.flatMap(id => { const event = events.get(id); return event ? [event] : []; });
    }
    async count(input: unknown): Promise<number> {
        const filters = localFilters(input).map(filterSql);
        return (await rows<{
            count: number;
        }>(this.database, `SELECT count(*) AS count FROM local_relay_events WHERE ${filters.map(f => `(${f.sql})`).join(' OR ')}`, filters.flatMap(f => f.params), ['count']))[0].count;
    }
    async event(id: string): Promise<Event | undefined> {
        if (!/^[a-f0-9]{64}$/.test(id))
            throw new Error('invalid-id');
        return (await this.query({ ids: [id], limit: 1 }))[0];
    }
    async replaceable(kind: number, pubkey: string, identifier = ''): Promise<Event | undefined> {
        const filter = { kinds: [kind], authors: [pubkey], ...(kind >= 30000 && kind < 40000 ? { '#d': [identifier] } : {}), limit: 1 };
        if (eventCoordinate({ kind, pubkey, tags: [['d', identifier]] }) === null)
            throw new Error('invalid-kind');
        return (await this.query(filter))[0];
    }
    async remove(ids: string[]): Promise<string[]> {
        if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)))
            throw new Error('invalid-ids');
        if (!ids.length)
            return [];
        return this.write(() => this.database.transaction(async (tx) => {
            const placeholders = ids.map(() => '?').join(',');
            const found = await rows<{
                id: string;
            }>(tx, `SELECT id FROM local_relay_events WHERE id IN (${placeholders})`, ids, ['id']);
            await tx.execute(`DELETE FROM local_relay_events WHERE id IN (${placeholders})`, ids, 'run');
            return found.map(row => row.id);
        }));
    }
    subscribe(input: unknown, event: (event: Event) => void): () => void {
        const listener = { filters: localFilters(input).map(({ limit, ...filter }) => filter), event };
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
}
