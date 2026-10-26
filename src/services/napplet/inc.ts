import { randomId } from './protocol';

type Envelope = Record<string, any>;
type Endpoint = { account: string; topics: Set<string>; send: (message: Envelope) => void };
/** Endpoint identities and sender fields are owned by the runtime, never the message. */
export class IncBroker {
  private endpoints = new Map<string, Endpoint>();
  private channels = new Map<string, [string, string]>();
  attach(id: string, account: string, send: Endpoint['send']): () => void {
    if (this.endpoints.has(id)) throw new Error('duplicate-endpoint');
    this.endpoints.set(id, { account, send, topics: new Set() });
    return () => {
      for (const [channelId, peers] of this.channels)
        if (peers.includes(id)) this.close(channelId, 'endpoint-closed');
      this.endpoints.delete(id);
    };
  }
  private close(id: string, reason?: string) {
    const peers = this.channels.get(id);
    if (!peers) return;
    this.channels.delete(id);
    peers.forEach((peer) =>
      this.endpoints.get(peer)?.send({ type: 'inc.channel.closed', channelId: id, reason }),
    );
  }
  async handle(sender: string, message: Envelope, authorize: (target: string) => Promise<void>) {
    const endpoint = this.endpoints.get(sender);
    if (!endpoint) throw new Error('endpoint-closed');
    const respond = (fields: Envelope = {}) =>
      endpoint.send({ type: `${message.type}.result`, id: message.id, ...fields });
    if (['inc.subscribe', 'inc.unsubscribe', 'inc.emit'].includes(message.type)) {
      const topic = message.topic;
      if (typeof topic !== 'string' || !topic || topic.length > 256 || topic.includes('#'))
        throw new Error('invalid-topic');
      if (message.type === 'inc.subscribe') {
        if (endpoint.topics.size >= 32 && !endpoint.topics.has(topic))
          throw new Error('quota-exceeded');
        endpoint.topics.add(topic);
        respond();
      } else if (message.type === 'inc.unsubscribe') endpoint.topics.delete(topic);
      else
        for (const target of this.endpoints.values()) {
          if (target.account === endpoint.account && target.topics.has(topic))
            target.send({ type: 'inc.event', topic, sender, payload: message.payload });
        }
      return;
    }
    if (message.type === 'inc.channel.open') {
      const target = this.endpoints.get(message.target);
      if (!target || target.account !== endpoint.account || message.target === sender)
        throw new Error('peer-unavailable');
      if ([...this.channels.values()].filter((peers) => peers.includes(sender)).length >= 16)
        throw new Error('quota-exceeded');
      await authorize(message.target);
      if (this.endpoints.get(sender) !== endpoint || this.endpoints.get(message.target) !== target)
        throw new Error('endpoint-closed');
      const channelId = randomId();
      this.channels.set(channelId, [sender, message.target]);
      target.send({ type: 'inc.channel.opened', channelId, peer: sender });
      respond({ channelId, peer: message.target });
      return;
    }
    if (message.type === 'inc.channel.list') {
      respond({
        channels: [...this.channels.entries()]
          .filter(([, peers]) => peers.includes(sender))
          .map(([id, peers]) => ({ id, peer: peers.find((peer) => peer !== sender) })),
      });
      return;
    }
    const route = (channelId: string) => {
      const peers = this.channels.get(channelId);
      if (!peers?.includes(sender)) throw new Error('channel-unavailable');
      if (message.type === 'inc.channel.close') this.close(channelId);
      else {
        const peer = peers.find((id) => id !== sender)!;
        this.endpoints
          .get(peer)
          ?.send({ type: 'inc.channel.event', channelId, sender, payload: message.payload });
      }
    };
    if (message.type === 'inc.channel.broadcast') {
      for (const [id, peers] of this.channels) if (peers.includes(sender)) route(id);
    } else route(message.channelId);
  }
}
export const incBroker = new IncBroker();
