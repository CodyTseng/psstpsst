import { createStore } from 'zustand/vanilla';
import type { Event } from 'nostr-tools';
import { assertNotAborted } from '@/platform/abort';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { getActiveAccountPubkey } from '@/services/account/account.service';
import { registerNappletLifecycle } from '@/services/napplet/lifecycle';
import { NappletNetwork } from '@/services/napplet/network';
import { DISCOVERY_RELAYS } from '@/lib/nostr/relay-url';
import { MARKET_RELAYS } from '@/services/napplet/protocol';
import { CommentIndex, MAX_THREAD_COMMENTS, type CommentRow } from './comments-index';
import { commentFilter, commentTemplate, isCommentCandidate, parseApplicationComment, type CommentTarget } from './comments-protocol';

const PAGE_SIZE = 100;
// Public discussions need relays that accept comments, independently of catalogue admission.
export const APPLICATION_COMMENT_RELAYS = [...new Set([...DISCOVERY_RELAYS, MARKET_RELAYS[0]])];
const active = new Set<ApplicationCommentsSession>();
const yieldFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export type CommentsState = { rows: CommentRow[]; loading: boolean; loaded: boolean; error: boolean; hasMore: boolean };

/** Public discussions own isolated, account-bound networking and never borrow mini-app permissions. */
export class ApplicationCommentsSession {
  readonly store = createStore<CommentsState>(() => ({ rows: [], loading: false, loaded: false, error: false, hasMore: true }));
  private index = new CommentIndex();
  private network?: NappletNetwork;
  private lifetime?: AbortController;
  private reading?: Promise<void>;
  private relayRequest?: Promise<string[]>;
  private posting?: Promise<Event>;
  private retry?: { content: string; parentId?: string; event: Event };
  private cursor?: number;
  private queue: Event[] = [];
  private draining?: AbortSignal;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(readonly account: string, readonly target: CommentTarget) {}

  start() {
    if (this.network) return;
    this.lifetime = new AbortController();
    this.network = new NappletNetwork(this.account);
    active.add(this);
    void this.load(true);
  }
  stop() {
    active.delete(this);
    this.lifetime?.abort(); this.lifetime = undefined;
    this.network?.destroy(); this.network = undefined;
    clearTimeout(this.timer); this.timer = undefined; this.queue = [];
    this.reading = undefined; this.relayRequest = undefined; this.posting = undefined; this.draining = undefined;
    this.store.setState({ loading: false });
  }
  private check(network: NappletNetwork, signal: AbortSignal) {
    assertNotAborted(signal);
    if (this.network !== network) throw new Error('session-closed');
  }
  private async checkAccount(network: NappletNetwork, signal: AbortSignal) {
    const [available, current] = await Promise.all([canReceiveForAccount(this.account), getActiveAccountPubkey()]);
    this.check(network, signal);
    if (!available || current !== this.account) throw new Error('account-unavailable');
  }
  private resolveRelays(network: NappletNetwork, signal: AbortSignal): Promise<string[]> {
    if (this.relayRequest) return this.relayRequest;
    const request = (async () => {
      const inbox = this.target.author
        ? await network.routes([this.target.author], 'read', true, signal).catch(error => {
          this.check(network, signal);
          if (error instanceof Error && error.message === 'recipient-relays-unavailable') return [];
          throw error;
        }) : [];
      this.check(network, signal);
      const relays = [...new Set([...inbox, ...APPLICATION_COMMENT_RELAYS])];
      network.subscribe({ relays, filters: [{ ...commentFilter(this.target, PAGE_SIZE), since: Math.floor(Date.now() / 1000) }],
        abort: signal, onEvent: event => this.enqueue(event) });
      return relays;
    })();
    this.relayRequest = request;
    void request.catch(() => { if (this.relayRequest === request) this.relayRequest = undefined; });
    return request;
  }
  private enqueue(event: Event) {
    if (!this.network || this.queue.length >= 128 || !isCommentCandidate(event) || this.index.get(event.id)) return;
    this.queue.push(event);
    this.scheduleDrain();
  }
  private scheduleDrain() {
    if (this.draining === this.lifetime?.signal || this.timer || !this.network) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const network = this.network, signal = this.lifetime?.signal;
      if (!network || !signal) return;
      this.draining = signal;
      void (async () => {
        while (this.queue.length) {
          this.check(network, signal);
          await this.merge(this.queue.splice(0, 32), network, signal);
        }
      })().catch(() => {}).finally(() => {
        if (this.draining === signal) {
          this.draining = undefined;
          if (this.queue.length) this.scheduleDrain();
        }
      });
    }, 0);
  }
  private async merge(events: Event[], network: NappletNetwork, signal: AbortSignal) {
    let changed = false;
    let verified = 0;
    for (let i = 0; i < Math.min(events.length, 500); i++) {
      if (events[i] && this.index.get(events[i].id)) continue;
      if (verified++ % 4 === 0) { await yieldFrame(); this.check(network, signal); }
      const parsed = parseApplicationComment(events[i], this.target);
      if (parsed) changed = this.index.add(parsed) || changed;
    }
    this.check(network, signal);
    if (changed) this.store.setState({ rows: this.index.rows() });
  }
  load(refresh = false): Promise<void> {
    if (this.reading) return this.reading;
    const network = this.network, signal = this.lifetime?.signal;
    if (!network || !signal || !refresh && !this.store.getState().hasMore) return Promise.resolve();
    this.store.setState({ loading: true, error: false });
    const until = refresh ? undefined : this.cursor;
    const request = (async () => {
      try {
        const relays = await this.resolveRelays(network, signal);
        this.check(network, signal);
        let limit = PAGE_SIZE;
        const before = this.index.size;
        while (true) {
          const result = await network.query(relays, [commentFilter(this.target, limit, until)], signal);
          this.check(network, signal);
          if (result.error) throw new Error(result.error);
          await this.merge(result.events, network, signal);
          // Nostr's inclusive timestamp cursor needs a wider boundary page when many events share a second.
          if (this.index.size === before && result.events.length >= limit && limit < MAX_THREAD_COMMENTS) {
            limit = Math.min(limit * 2, MAX_THREAD_COMMENTS); continue;
          }
          const timestamps = result.events.map(event => event.created_at).filter(value => Number.isSafeInteger(value) && value >= 0);
          if (timestamps.length) this.cursor = Math.min(...timestamps, ...(refresh && this.cursor !== undefined ? [this.cursor] : []));
          this.store.setState({ loaded: true, error: false,
            hasMore: this.index.size < MAX_THREAD_COMMENTS && result.events.length >= limit });
          break;
        }
      } catch {
        if (!signal.aborted && this.network === network) this.store.setState({ error: true });
      } finally {
        if (this.network === network) this.store.setState({ loading: false });
      }
    })();
    this.reading = request;
    void request.finally(() => { if (this.reading === request) this.reading = undefined; });
    return request;
  }
  post(content: string, parentId?: string): Promise<Event> {
    if (this.posting) return this.posting;
    const network = this.network, signal = this.lifetime?.signal;
    if (!network || !signal) return Promise.reject(new Error('session-closed'));
    const parent = parentId ? this.index.get(parentId) : undefined;
    if (parentId && !parent) return Promise.reject(new Error('reply-unavailable'));
    const request = (async () => {
      await yieldFrame(); this.check(network, signal);
      await this.checkAccount(network, signal);
      const relays = await this.resolveRelays(network, signal);
      this.check(network, signal);
      const template = commentTemplate(this.target, content, parent);
      const retry = this.retry;
      const event = retry?.content === template.content && retry.parentId === parentId ? retry.event : await network.sign(template);
      this.check(network, signal);
      if (!isCommentCandidate(event)) throw new Error('invalid-comment');
      this.retry = { content: template.content, parentId, event };
      await this.checkAccount(network, signal);
      const outcomes = await network.publish(event, relays);
      this.check(network, signal);
      if (!Object.values(outcomes).some(Boolean)) throw new Error('publish-failed');
      await this.merge([event], network, signal);
      this.retry = undefined;
      return event;
    })();
    this.posting = request;
    void request.then(() => { if (this.posting === request) this.posting = undefined; }, () => { if (this.posting === request) this.posting = undefined; });
    return request;
  }
}

registerNappletLifecycle(account => {
  for (const session of active) if (!account || session.account === account) session.stop();
});
