import { spacing, typography } from '@/theme';

import { BUBBLE_PADDING_HORIZONTAL, BUBBLE_PADDING_VERTICAL } from './bubble-layout';

/** Shared attachment geometry. Pending and stored bubbles must use the same
 * values so an upload settling never changes the message's shape. */
export const ATTACHMENT_MEDIA_MAX_WIDTH = 240;
export const ATTACHMENT_MEDIA_MAX_HEIGHT = 320;
export const ATTACHMENT_IMAGE_DEFAULT_ASPECT = 4 / 3;
export const ATTACHMENT_VIDEO_DEFAULT_ASPECT = 16 / 9;
export const ATTACHMENT_FILE_WIDTH = 240;
export const ATTACHMENT_VOICE_WIDTH = 220;
/** Specialist attachment controls use named geometry between spacing tokens. */
export const ATTACHMENT_ACTION_SIZE = 40;
/** Stable row height and touch target for an attachment's side failure action. */
export const ATTACHMENT_FAILURE_TARGET_SIZE = 44;
export const ATTACHMENT_SIDE_ACTION_SIZE = 20;
export const ATTACHMENT_SIDE_ACTION_HIT_SLOP =
  (ATTACHMENT_FAILURE_TARGET_SIZE - ATTACHMENT_SIDE_ACTION_SIZE) / 2;
export const ATTACHMENT_VOICE_ICON_SIZE = 18;
export const ATTACHMENT_FILE_ICON_SIZE = 20;
export const ATTACHMENT_MEDIA_ICON_SIZE = 24;
export const ATTACHMENT_MEDIA_TRANSFER_ACTION_SIZE = 56;
export const ATTACHMENT_VIDEO_ACTION_SIZE = 52;
/** Give the play control equal visual insets without padding the whole card. */
export const ATTACHMENT_VOICE_ACTION_INSET_VERTICAL =
  BUBBLE_PADDING_HORIZONTAL - BUBBLE_PADDING_VERTICAL;
/** Fit the waveform and clock footer within the padded play control's height. */
export const ATTACHMENT_VOICE_WAVEFORM_HEIGHT =
  ATTACHMENT_ACTION_SIZE + 2 * ATTACHMENT_VOICE_ACTION_INSET_VERTICAL
  - spacing.sm - typography.code.lineHeight;

export function fitAttachmentMediaBox(aspect: number): { width: number; height: number } {
  let width = ATTACHMENT_MEDIA_MAX_WIDTH;
  let height = width / aspect;
  if (height > ATTACHMENT_MEDIA_MAX_HEIGHT) {
    height = ATTACHMENT_MEDIA_MAX_HEIGHT;
    width = height * aspect;
  }
  return { width, height };
}
