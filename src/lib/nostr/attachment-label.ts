import { fileMime } from './file-tags';

type AttachmentLabels = {
  file: string;
  image: string;
  video: string;
  voice: string;
};

const DEFAULT_LABELS: AttachmentLabels = {
  file: '[File]',
  image: '[Image]',
  video: '[Video]',
  voice: '[Voice]',
};

/**
 * Single-line label used wherever a kind-15 message has to be summarised
 * (conversation list previews, reply quotes, etc.). Inspects the file-type
 * tag's mime so we can say "[Image]" / "[Video]" rather than a generic
 * "[File]".
 */
export function attachmentLabel(
  tags: string[][] | null | undefined,
  labels: AttachmentLabels = DEFAULT_LABELS,
): string {
  if (!tags) return labels.file;
  const mime = fileMime(tags) ?? '';
  if (mime.startsWith('image/')) return labels.image;
  if (mime.startsWith('video/')) return labels.video;
  if (mime.startsWith('audio/')) return labels.voice;
  return labels.file;
}
