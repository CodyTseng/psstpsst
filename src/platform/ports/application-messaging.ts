export type ApplicationEndpoint = {
  instance: string;
  accountPubkey: string;
  sourceId: string;
  title: string;
  actions: string[];
  domains: string[];
  auxiliary?: boolean;
};
export type ApplicationEnvelope = Record<string, any>;

/** Trusted hosts own endpoint identity; application documents only supply payloads. */
export interface ApplicationMessagingPort {
  connect(endpoint: ApplicationEndpoint): Promise<void>;
  disconnect(instance: string): Promise<void>;
  request(instance: string, message: ApplicationEnvelope): Promise<any>;
  onMessage(listener: (instance: string, message: ApplicationEnvelope) => void): () => void;
}
