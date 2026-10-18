import type { Event, EventTemplate } from 'nostr-tools';
import { localRelay } from '@/services/local-relay';
import { localFilters } from '@/services/local-relay/filters';
import { NappletNetwork, relayUrls } from '@/services/napplet/network';
/** Streams belong to a document; stored public events belong to the device. */
export class ExploreStreams {
    private streams = new Map<string, () => void>();
    constructor(private network: NappletNetwork) { }
    close(id: string) { this.streams.get(id)?.(); this.streams.delete(id); }
    clear() { for (const id of this.streams.keys())
        this.close(id); }
    open(method: string, args: any[], signal: AbortSignal, send: (message: object) => Promise<void>, auth: (event: EventTemplate) => Promise<Event>) {
        const [id, input, filterInput, options] = args;
        if (typeof id !== 'string' || !id || id.length > 64 || this.streams.has(id) || this.streams.size >= 8)
            throw new Error('invalid-subscription');
        const filters = localFilters(method === 'storeSubscribe' ? input : filterInput);
        let closed = false, cleanup = () => { };
        const close = () => { if (closed)
            return; closed = true; cleanup(); signal.removeEventListener('abort', close); this.streams.delete(id); };
        const emit = (message: object) => {
            if (!closed)
                void send({ type: 'stream', streamId: id, ...message }).catch(close);
        };
        const fail = (error: unknown) => { emit({ phase: 'closed', error: error instanceof Error ? error.message : 'subscription-failed' }); close(); };
        this.streams.set(id, close);
        signal.addEventListener('abort', close, { once: true });
        if (signal.aborted) {
            close();
            return;
        }
        try {
            if (method === 'storeSubscribe') {
                cleanup = localRelay.subscribe(filters, event => emit({ phase: 'event', event }));
            }
            else {
                const relays = relayUrls(input, []);
                if (!relays.length)
                    throw new Error('invalid-relays');
                const seen = new Set<string>();
                let initial = true, queued = 0, queuedBytes = 0, work = Promise.resolve();
                cleanup = this.network.subscribe({ relays, filters, abort: signal,
                    timeoutMs: Math.max(1000, Math.min(Number(options?.maxEoseTimeout) || 20000, 30000)),
                    onEvent: event => {
                        if (closed || seen.has(event.id))
                            return;
                        const bytes = event.content.length * 2 + JSON.stringify(event.tags).length * 2 + 512;
                        if (++queued > 128 || (queuedBytes += bytes) > 4 * 1024 * 1024) {
                            fail(new Error('subscription-overflow'));
                            return;
                        }
                        if (seen.size >= 8192)
                            seen.delete(seen.values().next().value!);
                        seen.add(event.id);
                        const phase = initial ? 'initial' : 'event';
                        work = work.then(async () => {
                            await new Promise<void>(resolve => setTimeout(resolve, 0));
                            if (closed)
                                return;
                            await send({ type: 'stream', streamId: id, phase, event });
                        }).catch(fail).finally(() => { queued--; queuedBytes -= bytes; });
                    },
                    onEose: () => { initial = false; void work.then(() => emit({ phase: 'eose' })); },
                    onRelayClose: (url, reason) => emit({ phase: 'relayClosed', url, reason }),
                }, auth);
            }
            if (closed)
                cleanup();
        }
        catch (error) {
            close();
            throw error;
        }
    }
}
