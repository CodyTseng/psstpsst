import * as Sharing from 'expo-sharing';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { Share as Share2 } from '@solar-icons/react-native/category/ui/Linear/Share';
import { DownloadMinimalistic as Download } from '@solar-icons/react-native/category/arrows-action/Linear/DownloadMinimalistic';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelRatio, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { BottomSheet } from '../common/BottomSheet';
import { NpubShareCard } from './NpubShareCard';
import { ProfileAction } from './ProfileAction';
import { setStringAsync } from '@/lib/clipboard';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { saveUriToLibrary } from '@/services/files/media-save.service';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

const EXPORT_WIDTH_PX = 1440;

function measureView(view: View): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    view.measure((_x, _y, width, height) => {
      if (width <= 0 || height <= 0) {
        reject(new Error('The profile card has no measurable size.'));
        return;
      }
      resolve({ width, height });
    });
  });
}

type Props = {
  visible: boolean;
  onClose: () => void;
  npub: string;
  /** Public identity only — never a private petname. */
  name?: string | null;
  nip05?: string | null;
};

/**
 * The single surface for sharing a user's npub QR — a grey sheet holding the
 * {@link NpubShareCard} and a Copy / Share / Save action row. Share and Save
 * capture its square export surface at print-friendly resolution.
 */
export function NpubQrSheet({ visible, onClose, npub, name, nip05 }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function captureCard() {
    if (!cardRef.current) throw new Error('The profile card is unavailable.');
    const layout = await measureView(cardRef.current);
    // Native capture dimensions are logical pixels, while the web-backed
    // Electron implementation uses output pixels directly.
    const width = IS_ELECTRON ? EXPORT_WIDTH_PX : EXPORT_WIDTH_PX / PixelRatio.get();
    return captureRef(cardRef, {
      format: 'png',
      quality: 1,
      width,
      height: width * (layout.height / layout.width),
    });
  }

  async function copy() {
    await setStringAsync(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) return;
      const uri = await captureCard();
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: name ?? undefined });
    } catch {
      // user cancelled or capture failed — nothing actionable to surface
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await captureCard();
      const result = await saveUriToLibrary(uri);
      if (result === 'denied') {
        await platform.confirmationDialog.notify({
          title: t('profile.qr_save_permission'),
          okLabel: t('common.ok'),
        });
        return;
      }
      if (result === 'failed') {
        await platform.confirmationDialog.notify({
          title: t('profile.qr_save_failed'),
          okLabel: t('common.ok'),
        });
        return;
      }
      await platform.confirmationDialog.notify({
        title: t('profile.qr_saved'),
        okLabel: t('common.ok'),
      });
    } catch (err) {
      await platform.confirmationDialog.notify({
        title: t('profile.qr_save_failed'),
        message: (err as Error)?.message,
        okLabel: t('common.ok'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('profile.show_qr')}
      contentStyle={{ gap: spacing.xl, alignItems: 'center' }}
    >
      <NpubShareCard ref={cardRef} npub={npub} name={name} nip05={nip05} />

      <View style={{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', gap: spacing.xl }}>
        <ProfileAction
          icon={
            copied ? (
              <Check strokeWidth={iconStrokeWidth.default} size={22} color={c.success} />
            ) : (
              <Copy size={22} color={c.text} />
            )
          }
          label={copied ? t('generate.copied') : t('profile.qr_copy')}
          onPress={copy}
        />
        <ProfileAction
          icon={<Share2 size={22} color={c.text} />}
          label={t('profile.qr_share')}
          onPress={share}
          disabled={busy}
        />
        <ProfileAction
          icon={<Download size={22} color={c.text} />}
          label={t('profile.qr_save')}
          onPress={save}
          disabled={busy}
        />
      </View>
    </BottomSheet>
  );
}
