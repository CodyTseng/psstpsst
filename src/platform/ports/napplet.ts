export type NappletBounds = { x: number; y: number; width: number; height: number };

/** Privileged transport only. No account credentials or application APIs cross this seam. */
export interface NappletPort {
  fetchResource(url: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>;
  open(html: string): Promise<string>;
  close(id: string): Promise<void>;
  send(id: string, message: string): Promise<void>;
  setBounds(id: string, bounds: NappletBounds, visible: boolean): Promise<void>;
  addMessageListener(listener: (id: string, message: string) => void): () => void;
}
