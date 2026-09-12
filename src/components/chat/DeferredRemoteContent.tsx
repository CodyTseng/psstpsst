import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { useCachedImages } from '@/hooks/use-cached-images';

import type { RemoteContentMode } from './remote-content-policy';

/** Gate downloads, never the display of bytes already stored on the device. */
export function DeferredRemoteContent({ mode, url, children }: {
  mode: RemoteContentMode;
  url: string;
  children: (localUri: string | null) => ReactNode;
}) {
  const { t } = useTranslation();
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [image] = useCachedImages([url], mode === 'auto' || (mode !== 'hold' && openedUrl === url), attempt);
  return (
    <View style={{ alignSelf: 'flex-start' }}>
      {children(image.uri)}
      {mode === 'request' && image.checked && !image.uri && (openedUrl !== url || image.failed) ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <AppButton
            variant="ghost"
            size="sm"
            fullWidth={false}
            label={t('attach.tap_to_load')}
            onPress={() => { setOpenedUrl(url); setAttempt((value) => value + 1); }}
          />
        </View>
      ) : null}
    </View>
  );
}
