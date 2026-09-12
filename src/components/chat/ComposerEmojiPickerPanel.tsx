import { lazy, memo, Suspense, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/common/SegmentedControl';
import type { CustomEmoji, EmojiPack } from '@/lib/nostr/custom-emoji';
import { shadow, spacing } from '@/theme';

import { EmojiPickerPanel } from './EmojiPickerPanel';

const LazyUnicodeEmojiPickerPanel = lazy(() =>
  import('./UnicodeEmojiPickerPanel').then((module) => ({
    default: module.UnicodeEmojiPickerPanel,
  })),
);

type Props = {
  active: boolean;
  customPacks: EmojiPack[];
  onSelect: (emoji: string | CustomEmoji) => void;
  safeBottom: number;
  standaloneCustomEmojis: CustomEmoji[];
  width: number;
};

type PickerMode = 'unicode' | 'custom';

const MODE_SWITCH_HEIGHT = 40;
const MODE_SWITCH_CONTENT_GAP = spacing.xl;

/** Inline composer picker. It opens on stickers and keeps Unicode one tab away. */
export const ComposerEmojiPickerPanel = memo(function ComposerEmojiPickerPanel({
  active,
  customPacks,
  onSelect,
  safeBottom,
  standaloneCustomEmojis,
  width,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<PickerMode>('custom');
  const contentBottomInset =
    safeBottom + MODE_SWITCH_HEIGHT + MODE_SWITCH_CONTENT_GAP;

  useEffect(() => {
    if (active) setMode('custom');
  }, [active]);

  return (
    <View style={{ flex: 1 }}>
      {mode === 'custom' ? (
        <EmojiPickerPanel
          active={active}
          onSelect={onSelect}
          customPacks={customPacks}
          standaloneCustomEmojis={standaloneCustomEmojis}
          safeBottom={contentBottomInset}
        />
      ) : (
        <Suspense fallback={<View style={{ flex: 1 }} />}>
          <LazyUnicodeEmojiPickerPanel
            bottomInset={contentBottomInset}
            onSelect={onSelect}
            width={width}
          />
        </Suspense>
      )}

      <SegmentedControl
        compact
        value={mode}
        options={[
          { value: 'unicode', label: t('chat.emoji.unicode') },
          { value: 'custom', label: t('chat.emoji.custom') },
        ]}
        onChange={setMode}
        style={{
          position: 'absolute',
          bottom: safeBottom,
          ...shadow.float,
        }}
      />
    </View>
  );
});
