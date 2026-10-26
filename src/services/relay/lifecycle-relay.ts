import {
  AbstractRelay,
  SendingOnClosedConnection,
  type AbstractRelayConstructorOptions,
} from 'nostr-tools/abstract-relay';

/** Managed callers connect first; socket writes must finish before local teardown. */
export class LifecycleRelay extends AbstractRelay {
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
