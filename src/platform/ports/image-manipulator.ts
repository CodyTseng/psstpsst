/**
 * Port for native image re-encoding — used to strip EXIF/GPS metadata before
 * sharing (`services/files/strip-metadata.ts`) and to render the ≤100px JPEG
 * that ThumbHash generation decodes in JS (`lib/image/thumbhash.ts`).
 *
 * Async-first — see the module note in `secure-storage.ts`.
 */

/** Output encoding. PNG is lossless; WebP is the compact chat-image default. */
export type ImageEncodeFormat = 'jpeg' | 'png' | 'webp';

/** A freshly saved re-encode; `base64` is present only when requested. */
export type RenderedImage = {
  uri: string;
  width: number;
  height: number;
  base64?: string;
};

export interface ImageManipulatorPort {
  /**
   * Re-render an image — optionally resized on a single dimension (the other
   * scales proportionally) — and save the result to a fresh cache file.
 * `quality` (0–1) is ignored for PNG and controls JPEG/WebP; with
   * `includeBase64` the encoded bytes are also returned for in-JS pixel
   * processing.
   */
  renderAndSave(
    uri: string,
    options: {
      resize?: { width?: number; height?: number };
      format: ImageEncodeFormat;
      quality: number;
      includeBase64?: boolean;
    },
  ): Promise<RenderedImage>;
}
