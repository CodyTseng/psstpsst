import Upload from 'lucide-react-native/icons/upload';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FileDropZone } from '@/components/common/FileDropZone';
import type { ComposerFile } from '@/lib/attachments/composer-file';
import { iconStrokeWidth } from '@/theme/icons';
import { useThemeColors } from '@/theme';

type Props = {
  children: ReactNode;
  enabled: boolean;
  onDropFiles: (files: ComposerFile[]) => void;
};

export function ChatFileDropZone(props: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <FileDropZone
      {...props}
      title={t('attach.drop_files_title')}
      hint={t('attach.drop_files_hint')}
      icon={<Upload strokeWidth={iconStrokeWidth.default} size={24} color={c.accent} />}
    />
  );
}
