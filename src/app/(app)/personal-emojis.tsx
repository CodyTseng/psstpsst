import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { StandaloneEmojiGrid } from '@/components/emoji/standalone-emoji-grid';
import { useAddCustomEmoji } from '@/hooks/use-add-custom-emoji';
import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import { useScrolled } from '@/hooks/use-scrolled';
import { showCustomEmojiDetail } from '@/stores/custom-emoji-detail.store';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, useThemeColors } from '@/theme';

export default function PersonalEmojisScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const titleClearance = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const collection = useCustomEmojis(accountPubkey);
  const addStandaloneEmoji = useAddCustomEmoji();
  const { scrolled, scrollProps } = useScrolled();
  const [editing, setEditing] = useState(false);

  return (
    <AppScreen edges={[]}>
      {collection.loaded ? (
        <StandaloneEmojiGrid
          active
          emojis={collection.standalone}
          editing={editing}
          onEditingChange={setEditing}
          doneActionInGrid={false}
          onAdd={() => void addStandaloneEmoji()}
          onSelect={showCustomEmojiDetail}
          onScroll={scrollProps.onScroll}
          scrollEventThrottle={scrollProps.scrollEventThrottle}
          safeBottom={insets.bottom}
          contentTopInset={titleClearance}
        />
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.lg,
            paddingTop: titleClearance + spacing.lg,
          }}
        >
          <ActivityIndicator color={c.accent} />
        </View>
      )}
      <ScreenHeader
        bordered={scrolled}
        title={t('emoji.personal_collection')}
        right={
          collection.loaded ? (
            <AppButton
              label={editing ? t('common.done') : t('common.edit')}
              variant="text"
              fullWidth={false}
              disabled={!editing && collection.standalone.length === 0}
              onPress={() => setEditing((current) => !current)}
            />
          ) : undefined
        }
      />
    </AppScreen>
  );
}
