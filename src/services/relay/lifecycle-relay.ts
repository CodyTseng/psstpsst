import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools';
import {
  AbstractRelay,
  SendingOnClosedConnection,
  type AbstractRelayConstructorOptions,
} from 'nostr-tools/abstract-relay';

import { RelayPublishRejection, parseRelayRetryAfterMs } from './publish-retry';

/** Managed callers connect first; socket writes must finish before local teardown. */
export class LifecycleRelay extends AbstractRelay {
  private readonly acknowledgements = new Map<string, { rejection?: RelayPublishRejection }>();
  private readonly publications = new Map<string, Promise<string>>();
  private readonly openState: number;
  private readonly currentSocket: () => WebSocket | undefined;

  constructor(url: string, options: AbstractRelayConstructorOptions) {
    let socket: WebSocket | undefined;
    const Socket = options.websocketImplementation ?? WebSocket;
    super(url, {
      ...options,
      websocketImplementation: class extends Socket {
        constructor(address: string | URL, protocols?: string | string[]) {
          super(address, protocols);
          socket = this;
        }
      },
    });
    this.openState = Socket.OPEN;
    this.currentSocket = () => socket;
  }

  override publish(event: Event): Promise<string> {
    const existing = this.publications.get(event.id);
    if (existing) return existing;
    const ack: { rejection?: RelayPublishRejection } = {};
    this.acknowledgements.set(event.id, ack);
    const pending = super.publish(event).catch((error: unknown) => {
      throw ack.rejection ?? error;
    }).finally(() => {
      this.acknowledgements.delete(event.id);
      this.publications.delete(event.id);
    });
    this.publications.set(event.id, pending);
    return pending;
  }

  override async auth(sign: (template: EventTemplate) => Promise<VerifiedEvent>): Promise<string> {
    const ack: { rejection?: RelayPublishRejection } = {};
    let id: string | undefined;
    try {
      return await super.auth(async (template) => {
        const event = await sign(template);
        id = event.id;
        this.acknowledgements.set(id, ack);
        return event;
      });
    } catch (error) {
      throw ack.rejection ?? error;
    } finally {
      if (id) this.acknowledgements.delete(id);
    }
  }

  override _onmessage(event: MessageEvent): void {
    // nostr-tools rejects both negative OKs and socket failures with Error.
    // Record the wire outcome before handing the frame to its normal handler.
    if (this.acknowledgements.size > 0 && typeof event.data === 'string' && /^\s*\[\s*"OK"/.test(event.data)) {
      try {
        const [type, id, ok, reason, params] = JSON.parse(event.data);
        const ack = this.acknowledgements.get(id);
        if (type === 'OK' && ok === false && ack) {
          ack.rejection = new RelayPublishRejection(
            typeof reason === 'string' ? reason : 'Relay rejected the event',
            parseRelayRetryAfterMs(params),
          );
        }
      } catch { /* The upstream handler owns malformed frames. */ }
    }
    super._onmessage(event);
  }

  override async send(message: string): Promise<void> {
    const socket = this.currentSocket();
    try {
      if (!this.connected || !socket || socket.readyState !== this.openState) {
        throw new SendingOnClosedConnection(message, this.url);
      }
      // Keep the readiness check and write in the same synchronous turn.
      socket.send(message);
    } catch (error) {
      // Subscription.fire(), auth(), and Subscription.close() do not observe
      // send's promise. Cleanup is best-effort; failed REQ/AUTH frames must
      // instead retire the socket so the managed pool can restore demand.
      if (message.startsWith('["CLOSE",')) return;
      if (message.startsWith('["REQ",') || message.startsWith('["AUTH",')) {
        // Let subscribe() install its handle before close callbacks run.
        queueMicrotask(() => {
          if (this.currentSocket() === socket && this.connected) this.close();
        });
        return;
      }
      throw error;
    }
  }
}
