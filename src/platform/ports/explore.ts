/** Verified static files or an ordinary remote page, isolated from the host renderer. */
export type ExplorePage = {
  labels?: { ok: string; cancel: string; allow: string };
  bootstrap?: ExploreBootstrap;
  url?: string;
  sourceId: string;
  storageId?: string;
  files?: {
    path: string;
    mime: string;
    body: string;
  }[];
  script: string;
  network: boolean;
};
/** Host-owned bootstrap code is bundled by each adapter; only this small descriptor crosses IPC. */
export type ExploreBootstrap = {
  napp: boolean;
  theme?: { background: string; text: string; primary: string };
  domains: string[];
  instance: string;
};
/** Origin and document are attached by the platform, never by page JavaScript. */
export type ExploreMessage = {
  type: 'explore.request' | 'explore.navigation' | 'explore.error' | 'explore.browser';
  browser?: BrowserRequest;
  origin: string;
  document: string;
  raw?: string;
  url?: string;
  error?: string;
};
export type BrowserRequest = { id: string; action: 'window' | 'external' | 'permission' | 'download'; url?: string; resources?: string[]; filename?: string };
