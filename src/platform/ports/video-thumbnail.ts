/** Best-effort poster metadata generation for a local video attachment. */
export interface VideoThumbnailPort {
  generateThumbhash(uri: string): Promise<string | undefined>;
}
