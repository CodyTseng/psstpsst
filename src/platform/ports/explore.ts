/** Verified static files or an ordinary remote page, isolated from the host renderer. */
export type ExplorePage = {
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
/** Origin and document are attached by the platform, never by page JavaScript. */
export type ExploreMessage = {
  type: 'explore.request' | 'explore.navigation';
  origin: string;
  document: string;
  raw?: string;
  url?: string;
};
