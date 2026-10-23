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
    if (!this.connected || !socket || socket.readyState !== this.openState) {
      // CLOSE is best-effort cleanup; a closing peer no longer needs the frame.
      if (message.startsWith('["CLOSE",')) return;
      throw new SendingOnClosedConnection(message, this.url);
    }
    // AbstractRelay.send queues an untracked promise callback which can run after
    // close(). Keep the readiness check and write in the same synchronous turn.
    socket.send(message);
  }
}
