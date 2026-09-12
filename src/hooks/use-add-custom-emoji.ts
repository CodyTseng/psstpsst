import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { platform } from '@/platform';
import {
  cancelEmojiDraftRequest,
  createEmojiDraftRequest,
  type UploadedEmojiDraft,
} from '@/services/emoji/custom-emoji-image-handoff';

type DraftTarget = {
  existingShortcodes: readonly string[];
  onComplete: (draft: UploadedEmojiDraft) => void;
};

/** Opens the shared single-image picker and naming/crop route. */
export function useAddCustomEmoji(target?: DraftTarget): () => Promise<void> {
  const { t } = useTranslation();
  const openingRef = useRef(false);
  const requestIdRef = useRef<string | undefined>(undefined);

  useEffect(
    () => () => {
      if (requestIdRef.current) {
        cancelEmojiDraftRequest(requestIdRef.current);
      }
    },
    [],
  );

  return useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        exif: false,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      });
      const selected = result.canceled ? undefined : result.assets[0];
      if (!selected) return;

      const requestId = target
        ? createEmojiDraftRequest({
            existingShortcodes: target.existingShortcodes,
            onComplete: target.onComplete,
          })
        : undefined;
      requestIdRef.current = requestId;
      router.push({
        pathname: '/add-custom-emoji',
        params: {
          uri: selected.uri,
          width: selected.width,
          height: selected.height,
          mime: selected.mimeType ?? 'image/jpeg',
          fileName: selected.fileName ?? '',
          ...(requestId ? { draftRequestId: requestId } : {}),
        },
      });
    } catch {
      if (requestIdRef.current) {
        cancelEmojiDraftRequest(requestIdRef.current);
        requestIdRef.current = undefined;
      }
      void platform.confirmationDialog.notify({
        title: t('emoji.add_custom_failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      openingRef.current = false;
    }
  }, [t, target]);
}
