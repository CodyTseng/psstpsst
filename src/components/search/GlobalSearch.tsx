import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, View } from 'react-native';

import { useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { GlobalSearchResults } from '@/components/search/GlobalSearchResults';
import { SearchBar, SEARCH_BAR_SCREEN_GUTTER } from '@/components/search/SearchBar';
import { SEARCH_ACTIVATION_SHORTCUT_LABEL } from '@/components/search/search-shortcut';
import { SearchTransition } from '@/components/search/SearchTransition';
import { spacing, uiDensity } from '@/theme';

/**
 * The Chats-tab search transition. It owns the volatile `query` state so a
 * keystroke re-renders only this subtree and the results, never the inbox. The
 * resting inbox remains visible until the query contains searchable text.
 */
export function GlobalSearch({
  accountPubkey,
  active,
  focused,
  onActivate,
  onClose,
  children,
}: {
  accountPubkey: string;
  active: boolean;
  focused: boolean;
  onActivate: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const topClearance = useScreenHeaderClearance();

  function close() {
    setQuery('');
    Keyboard.dismiss();
    onClose();
  }

  return (
    <SearchTransition
      active={active}
      contentActive={query.trim().length > 0}
      focused={focused}
      onActivate={onActivate}
      onCancel={close}
      activeChrome={
        <View
          style={{
            paddingHorizontal: SEARCH_BAR_SCREEN_GUTTER,
            paddingTop: topClearance,
            paddingBottom: spacing.sm,
          }}
        >
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            shortcutHint={SEARCH_ACTIVATION_SHORTCUT_LABEL}
            autoFocus
            onBlur={() => {
              if (query.trim().length === 0) onClose();
            }}
          />
        </View>
      }
      activeContent={
        <View
          style={{
            flex: 1,
            paddingTop: topClearance + uiDensity.searchBarHeight + spacing.sm,
          }}
        >
          <GlobalSearchResults accountPubkey={accountPubkey} query={query} />
        </View>
      }
    >
      {children}
    </SearchTransition>
  );
}
