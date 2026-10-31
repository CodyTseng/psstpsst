import { Gallery as ImageIcon } from '@solar-icons/react-native/category/video/Linear/Gallery';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ListRow } from '@/components/common/ListRow';
import { useThemeColors } from '@/theme';

export function ChatWallpaperRow({ conversationKey }: { conversationKey?: string }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <ListRow
      icon={<ImageIcon size={22} color={c.text} />}
      title={t('wallpaper.title')}
      trailing={<DirectionalChevron size={18} color={c.textMuted} />}
      onPress={() => router.push({ pathname: '/chat-wallpaper', params: conversationKey ? { key: conversationKey } : {} })}
    />
  );
}
