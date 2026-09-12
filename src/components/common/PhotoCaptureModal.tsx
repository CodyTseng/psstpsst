import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera } from '@solar-icons/react-native/category/video/Linear/Camera';
import X from 'lucide-react-native/icons/x';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

import { IconButton } from './IconButton';

export type CapturedPhoto = {
  uri: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
  type: 'image';
};

type Props = {
  visible: boolean;
  permissionDeniedMessage: string;
  accessibilityLabel: string;
  onClose: () => void;
  onCaptured: (photo: CapturedPhoto) => void | Promise<void>;
  quality?: number;
};

/** A real webcam capture surface for Electron, where image-picker only opens a file input. */
export function PhotoCaptureModal({
  visible,
  permissionDeniedMessage,
  accessibilityLabel,
  onClose,
  onCaptured,
  quality = 0.85,
}: Props) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const closeRef = useRef(onClose);
  const deniedMessageRef = useRef(permissionDeniedMessage);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    closeRef.current = onClose;
    deniedMessageRef.current = permissionDeniedMessage;
  }, [onClose, permissionDeniedMessage]);

  useEffect(() => {
    if (!visible || permission?.granted) return;
    let active = true;
    void requestPermission().then((result) => {
      if (!active || result.granted) return;
      closeRef.current();
      void platform.confirmationDialog.notify({
        title: deniedMessageRef.current,
        okLabel: t('common.ok'),
      });
    });
    return () => {
      active = false;
    };
  }, [permission?.granted, requestPermission, t, visible]);

  async function capture() {
    if (busy) return;
    setBusy(true);
    try {
      const picture = await cameraRef.current?.takePictureAsync({ quality });
      if (!picture) return;
      let uri = picture.uri;
      if (IS_ELECTRON) {
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Unable to read captured photo (${response.status})`);
        uri = `${await platform.fileSystem.cacheDirectoryUri()}camera-${await platform.deviceCrypto.randomUUID()}.jpg`;
        await platform.fileSystem.writeBytes(uri, new Uint8Array(await response.arrayBuffer()));
      }
      await onCaptured({
        uri,
        width: picture.width,
        height: picture.height,
        mimeType: 'image/jpeg',
        type: 'image',
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.background }}>
        {visible && permission?.granted ? (
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.textMuted} />
          </View>
        )}
        <IconButton
          variant="overlay"
          onPress={onClose}
          hitSlop={spacing.sm}
          style={{ position: 'absolute', top: insets.top + spacing.sm, start: spacing.lg }}
          icon={<X strokeWidth={iconStrokeWidth.default} size={20} color={c.onOverlay} />}
          accessibilityLabel={accessibilityLabel}
        />
        <View
          style={{
            position: 'absolute',
            alignSelf: 'center',
            bottom: insets.bottom + spacing.xl,
          }}
        >
          <IconButton
            variant="overlay"
            size={64}
            disabled={busy || !permission?.granted}
            onPress={() => void capture()}
            icon={<Camera size={28} color={c.onOverlay} />}
            accessibilityLabel={accessibilityLabel}
          />
        </View>
      </View>
    </Modal>
  );
}
