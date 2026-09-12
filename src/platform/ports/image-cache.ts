/** Local image bytes and explicitly authorized downloads are separate operations. */
export interface ImageCachePort {
  getCachedUri(url: string): Promise<string | null>;
  download(url: string): Promise<string>;
}
