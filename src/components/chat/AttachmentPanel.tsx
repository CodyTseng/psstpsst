import { Camera } from '@solar-icons/react-native/category/video/Linear/Camera';
import { Gallery as ImageIcon } from '@solar-icons/react-native/category/video/Linear/Gallery';
import { FileSend as FileUp } from '@solar-icons/react-native/category/files/Linear/FileSend';
import { BillList as ReceiptText } from '@solar-icons/react-native/category/money/Linear/BillList';
import { UserId } from '@solar-icons/react-native/category/users/Linear/UserId';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { spacing, typography, useThemeColors } from '@/theme';

export type AttachmentSource = 'invoice' | 'camera' | 'library' | 'file' | 'card';

export const ATTACHMENT_OPTIONS = [
  { key: 'camera', icon: Camera, labelKey: 'attach.camera' },
  { key: 'library', icon: ImageIcon, labelKey: 'attach.library' },
  { key: 'file', icon: FileUp, labelKey: 'attach.file' },
  { key: 'invoice', icon: ReceiptText, labelKey: 'attach.create_invoice' },
  { key: 'card', icon: UserId, labelKey: 'attach.contact_card' },
] as const satisfies readonly {
  key: AttachmentSource;
  icon: typeof Camera;
  labelKey: string;
}[];

type Props = {
  onPick: (source: AttachmentSource) => void;
  sources: readonly AttachmentSource[];
  width: number;
};

const PANEL_PADDING = spacing.lg;
const PANEL_TOP = spacing.md;
const COL_GAP = spacing.md;
const COLUMNS = 4;
const ROW_GAP = spacing.md;
const LABEL_GAP = spacing.xs;
const ATTACHMENT_PANEL_ICON_SIZE = 28;

const tileSize = (width: number) =>
  Math.floor((width - PANEL_PADDING * 2 - COL_GAP * (COLUMNS - 1)) / COLUMNS);

/** The tray's natural height, computed from the same metrics the
 * panel renders with — so `ChatInput` can size the slide-open without a fragile
 * measure-while-clipped layout pass. Rows follow the visible option count. */
export function attachmentPanelHeight(
  width: number,
  safeBottom: number,
  optionCount: number,
): number {
  const rows = Math.max(1, Math.ceil(optionCount / COLUMNS));
  return (
    PANEL_TOP +
    rows * (tileSize(width) + LABEL_GAP + typography.caption.lineHeight) +
    ROW_GAP * (rows - 1) +
    Math.max(safeBottom, PANEL_PADDING)
  );
}

/** The inline attachment tray that rises in place of the keyboard: white square
 * tiles over the composer's grey. Presentational —
 * `ChatInput` owns the open/close + keyboard coordination. Memoized (with a
 * stable `onPick`) so it never re-renders on keystrokes or when the tray
 * toggles — only the wrapping height animates, keeping the open frame cheap. */
export const AttachmentPanel = memo(function AttachmentPanel({ onPick, sources, width }: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  const tile = tileSize(width);

  const options = ATTACHMENT_OPTIONS.filter((option) => sources.includes(option.key));

  return (
    <View
      style={{
        paddingHorizontal: PANEL_PADDING,
        paddingTop: PANEL_TOP,
        paddingBottom: Math.max(insets.bottom, PANEL_PADDING),
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: COL_GAP,
        rowGap: ROW_GAP,
      }}
    >
      {options.map((o) => {
        const Icon = o.icon;
        const label = t(o.labelKey);
        return (
          <View key={o.key} style={{ width: tile, alignItems: 'center', gap: LABEL_GAP }}>
            <IconButton
              variant="surface"
              shape="square"
              size={tile}
              onPress={() => onPick(o.key)}
              icon={<Icon size={ATTACHMENT_PANEL_ICON_SIZE} color={c.textMuted} />}
              accessibilityLabel={label}
            />
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
});
