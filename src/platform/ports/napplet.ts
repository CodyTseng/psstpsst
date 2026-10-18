import type { ApplicationWindowsPort } from './application-window';
import type { ExplorePage } from './explore';
export type NappletBounds = { x: number; y: number; width: number; height: number };

/** Private wrapper presentation signal, separate from application NAP messages. */
export const NAPPLET_FRAME_READY = 'psst.frameReady';
export const NAPPLET_FRAME_READY_MESSAGE = JSON.stringify({ type: NAPPLET_FRAME_READY });

/** Privileged transport only. No account credentials or application APIs cross this seam. */
export interface NappletPort {
  windows?: ApplicationWindowsPort;
  fetchResource(url: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>;
  clearPageData?(storageId: string): Promise<void>;
  openPage?(page: ExplorePage): Promise<string>;
  open(html: string): Promise<string>;
  close(id: string): Promise<void>;
  /** Ephemeral overlay preview; native-modal platforms do not need one. */
  capture(id: string): Promise<string | null>;
  /** Traverse the container's own history; false means it is already at its root. */
  goBack(id: string): Promise<boolean>;
  send(id: string, message: string): Promise<void>;
  setBounds(id: string, bounds: NappletBounds, visible: boolean, interactive?: boolean): Promise<void>;
  addMessageListener(listener: (id: string, message: string) => void): () => void;
}
