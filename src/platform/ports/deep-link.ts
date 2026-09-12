/** URLs delivered by the operating system after the app has started. */
export interface DeepLinkPort {
  /** Consume the newest pending URL, if one arrived before a listener attached. */
  takePendingUrl(): Promise<string | null>;
  /** Notify the renderer that a URL is ready to consume. */
  addListener(listener: () => void): () => void;
}
