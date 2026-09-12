import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Gallery as Image } from '@solar-icons/react-native/category/video/Linear/Gallery';
import { Scanner } from '@solar-icons/react-native/category/security/Linear/Scanner';
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from './IconButton';
import { RoundOverlayAction } from './RoundOverlayAction';
import { ScannerCloseButton } from './scanner-close-button';
import { platform } from '@/platform';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Props = {
  /** Called with the raw scanned string (e.g. `npub1…` or `nostr:npub1…`). */
  onScanned: (data: string) => void;
  /** Container size — defaults to the platform input height. */
  size?: number;
  variant?: 'plain' | 'surface' | 'secondary' | 'accent' | 'overlay';
  shape?: 'circle' | 'square';
  iconSize?: number;
  showTrigger?: boolean;
};

export type QrScanButtonHandle = {
  open: () => Promise<void>;
};

/**
 * A square icon button that opens a full-screen QR scanner. Shared by the
 * new-chat and search-user flows; the caller parses the scanned string — this
 * component only returns raw text.
 */
export const QrScanButton = forwardRef<QrScanButtonHandle, Props>(function QrScanButton(
  {
    onScanned,
    size = uiDensity.inputHeight,
    variant = 'surface',
    shape = 'square',
    iconSize = 20,
    showTrigger = true,
  },
  ref,
) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handledRef = useRef(false);
  const overlayActionSize = 64;
  const overlayActionBottom = insets.bottom + spacing.xl;

  const handleOpen = useCallback(async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        void platform.confirmationDialog.notify({
          title: t('scan.permission'),
          okLabel: t('common.ok'),
        });
        return;
      }
    }
    handledRef.current = false;
    setOpen(true);
  }, [permission?.granted, requestPermission, t]);

  useImperativeHandle(ref, () => ({ open: handleOpen }), [handleOpen]);

  function handleBarcode(data: string) {
    if (handledRef.current) return;
    handledRef.current = true;
    setOpen(false);
    onScanned(data);
  }

  async function scanImageFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled) return;

    try {
      const barcodes = await scanFromURLAsync(result.assets[0].uri, ['qr']);
      const data = barcodes.find((barcode) => barcode.data.trim())?.data;
      if (!data) {
        void platform.confirmationDialog.notify({
          title: t('scan.no_qr_found'),
          okLabel: t('common.ok'),
        });
        return;
      }
      handleBarcode(data);
    } catch {
      void platform.confirmationDialog.notify({
        title: t('scan.no_qr_found'),
        okLabel: t('common.ok'),
      });
    }
  }

  return (
    <>
      {showTrigger ? (
        <IconButton
          variant={variant}
          shape={shape}
          size={size}
          onPress={handleOpen}
          icon={<Scanner size={iconSize} color={c.text} />}
          accessibilityLabel={t('scan.title')}
        />
      ) : null}

      <Modal visible={open} animationType={reducedMotion ? 'fade' : 'slide'} onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.background }}>
          {open ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(r) => handleBarcode(r.data)}
            />
          ) : null}

          <ScannerCloseButton onClose={() => setOpen(false)} />

          <View
            style={{
              position: 'absolute',
              end: spacing.lg,
              bottom: overlayActionBottom,
            }}
          >
            <RoundOverlayAction
              label={t('scan.from_photos')}
              size={overlayActionSize}
              width={112}
              onPress={() => void scanImageFromLibrary()}
              icon={<Image size={24} color={c.onOverlay} />}
            />
          </View>

        </View>
      </Modal>
    </>
  );
});
