/** Best-effort poster metadata generation for a local video attachment. */
export type VideoThumbnailMetadata = {
  width: number;
  height: number;
  thumbhash?: string;
  posterUri?: string;
};

export interface VideoThumbnailPort {
  /** Decode once for both display dimensions and the optional placeholder. */
  generateMetadata(uri: string, options?: { includeThumbhash?: boolean; posterUri?: string }): Promise<VideoThumbnailMetadata | undefined>;
}
