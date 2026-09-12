import { Camera } from '@solar-icons/react-native/category/video/Linear/Camera';
import { Gallery as ImageIcon } from '@solar-icons/react-native/category/video/Linear/Gallery';
import { Link as LinkIcon } from '@solar-icons/react-native/category/text-formatting/Linear/Link';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type TextInput, View } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppInput } from '@/components/common/AppInput';
import { BottomSheet } from '@/components/common/BottomSheet';
import { InputDialog } from '@/components/common/InputDialog';
import { ListRow } from '@/components/common/ListRow';
import { IS_ELECTRON } from '@/lib/platform';
import { useThemeColors } from '@/theme';

type Props = {
  visible: boolean;
  currentUrl: string;
  onClose: () => void;
  onClosed?: () => void;
  onPickLibrary: () => void;
  onPickCamera: () => void;
  onSubmitUrl: (url: string) => void;
};

/** Bottom sheet offering the three ways to set a profile image: library, camera, URL. */
export function ImageSourcePicker({
  visible,
  currentUrl,
  onClose,
  onClosed,
  onPickLibrary,
  onPickCamera,
  onSubmitUrl,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [mode, setMode] = useState<'options' | 'url'>('options');
  const [url, setUrl] = useState('');
  const urlInputRef = useRef<TextInput>(null);
  // Electron: the URL entry is a pure single-field form, so it leaves the
  // options sheet and continues in the centered input dialog once the sheet
  // has fully closed (DESIGN §10 Electron presentation split).
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [urlRequested, setUrlRequested] = useState(false);

  useEffect(() => {
    if (visible) {
      setMode('options');
      setUrl(currentUrl);
    }
  }, [visible, currentUrl]);

  function submitUrl() {
    setUrlDialogOpen(false);
    onSubmitUrl(url.trim());
  }

  const options = [
    { key: 'library', icon: ImageIcon, label: t('profile_edit.source_library'), onPress: onPickLibrary },
    { key: 'camera', icon: Camera, label: t('profile_edit.source_camera'), onPress: onPickCamera },
    {
      key: 'url',
      icon: LinkIcon,
      label: t('profile_edit.source_url'),
      onPress: () => {
        if (IS_ELECTRON) {
          setUrlRequested(true);
          onClose();
        } else {
          setMode('url');
        }
      },
    },
  ];

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        inputFocusRef={mode === 'url' ? urlInputRef : undefined}
        inputFocusKey={mode}
        title={t(mode === 'url' ? 'profile_edit.url_title' : 'profile.edit_photo')}
        onClosed={() => {
          if (urlRequested) {
            setUrlRequested(false);
            setUrlDialogOpen(true);
          }
          onClosed?.();
        }}
      >
        {mode === 'options' ? (
          <View style={{ gap: 4 }}>
            {options.map((o) => {
              const Icon = o.icon;
              return (
                <ListRow
                  key={o.key}
                  variant="plain"
                  icon={<Icon size={22} color={c.text} />}
                  title={o.label}
                  onPress={o.onPress}
                />
              );
            })}
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <AppInput
              ref={urlInputRef}
              value={url}
              onChangeText={setUrl}
              placeholder={t('profile_edit.image_url_placeholder')}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <ActionRow
              layout="vertical"
              confirm={{ label: t('profile_edit.url_confirm'), onPress: () => onSubmitUrl(url.trim()) }}
            />
          </View>
        )}
      </BottomSheet>

      <InputDialog
        visible={urlDialogOpen}
        onClose={() => setUrlDialogOpen(false)}
        actionLayout="vertical"
        confirmLabel={t('profile_edit.url_confirm')}
        onConfirm={submitUrl}
      >
        <AppInput
          value={url}
          onChangeText={setUrl}
          placeholder={t('profile_edit.image_url_placeholder')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          autoFocus
          onSubmitEditing={submitUrl}
        />
      </InputDialog>
    </>
  );
}
