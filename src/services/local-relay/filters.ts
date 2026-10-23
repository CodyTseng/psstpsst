import type { Filter } from 'nostr-tools';
import type { SqlBindValue } from '@/platform/ports/database';
export function localFilters(input: unknown): Filter[] {
    const filters = Array.isArray(input) ? input : [input];
    if (!filters.length || filters.length > 8)
        throw new Error('invalid-filter');
    return filters.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('invalid-filter');
        const filter: Record<string, any> = {};
        for (const [key, items] of Object.entries(value)) {
            if (['ids', 'authors', 'kinds'].includes(key) || /^#[a-zA-Z]$/.test(key)) {
                if (!Array.isArray(items) || items.length > 100 || items.some(item => key === 'kinds'
                    ? !Number.isInteger(item) || item < 0 || item > 65535
                    : typeof item !== 'string' || ['ids', 'authors', '#e', '#p'].includes(key) && !/^[a-f0-9]{64}$/.test(item)))
                    throw new Error('invalid-filter');
                filter[key] = [...items];
            }
            else if (['since', 'until', 'limit'].includes(key)) {
                if (!Number.isSafeInteger(items) || key === 'limit' && (items as number) < 0)
                    throw new Error('invalid-filter');
                filter[key] = key === 'limit' ? Math.min(items as number, 1000) : items;
            }
            else
                throw new Error(`unsupported-filter: ${key.slice(0, 40)}`);
        }
        return filter as Filter;
    });
}
/** Every term is bound; tag lookups use the covering (name,value,event_id) index. */
export function filterSql(filter: Filter): {
    sql: string;
    params: SqlBindValue[];
} {
    const terms = ['(expires_at IS NULL OR expires_at > ?)'];
    const params: SqlBindValue[] = [Math.floor(Date.now() / 1000)];
    for (const [key, value] of Object.entries(filter)) {
        if (key === 'limit')
            continue;
        if (Array.isArray(value)) {
            if (!value.length) {
                terms.push('0');
                continue;
            }
            const placeholders = value.map(() => '?').join(',');
            if (key.startsWith('#')) {
                terms.push(`id IN (SELECT event_id FROM local_relay_tags WHERE name=? AND value IN (${placeholders}))`);
                params.push(key.slice(1), ...value);
            }
            else {
                terms.push(`${key === 'ids' ? 'id' : key === 'authors' ? 'pubkey' : 'kind'} IN (${placeholders})`);
                params.push(...value);
            }
        }
        else {
            terms.push(`created_at ${key === 'since' ? '>=' : '<='} ?`);
            params.push(value as number);
        }
    }
    return { sql: terms.join(' AND '), params };
}
