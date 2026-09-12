import { SquareArrowRightUp } from '@solar-icons/react-native/category/arrows/Linear/SquareArrowRightUp';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TextInput } from 'react-native';

import { ActionRow } from '@/components/common/ActionRow';
import { AppInput } from '@/components/common/AppInput';
import { BottomSheet } from '@/components/common/BottomSheet';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { InputDialog } from '@/components/common/InputDialog';
import { ListRow } from '@/components/common/ListRow';
import { useDirectionalIconStyle } from '@/i18n/direction';
import { DEFAULT_NOSTR_EVENT_URL, normalizeNostrEventUrl } from '@/lib/nostr/event-url';
import { IS_ELECTRON } from '@/lib/platform';
import { useChatPrefsStore } from '@/stores/chat-prefs.store';
import { spacing, useThemeColors } from '@/theme';

/** Keep the draft local so typing never updates chat cards or the settings page. */
export function NostrEventUrlSetting() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const directionalIconStyle = useDirectionalIconStyle();
  const savedUrl = useChatPrefsStore((s) => s.nostrEventUrl);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(savedUrl);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const close = () => setVisible(false);

  function save() {
    const normalized = normalizeNostrEventUrl(draft);
    if (normalized == null) {
      setInvalid(true);
      return;
    }
    useChatPrefsStore.getState().setNostrEventUrl(normalized);
    close();
  }

  const input = (
    <AppInput
      ref={inputRef}
      label={t('chats.nostr_event_url_label')}
      description={t('chats.nostr_event_url_hint')}
      error={invalid ? t('chats.nostr_event_url_invalid') : undefined}
      placeholder={DEFAULT_NOSTR_EVENT_URL}
      value={draft}
      onChangeText={(value) => {
        setDraft(value);
        setInvalid(false);
      }}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={IS_ELECTRON}
      keyboardType="url"
      returnKeyType="done"
      maxLength={2048}
      onSubmitEditing={save}
    />
  );

  return (
    <>
      <ListRow
        icon={<SquareArrowRightUp size={22} color={c.text} style={directionalIconStyle} />}
        title={t('chats.nostr_event_url')}
        trailing={<DirectionalChevron size={18} color={c.textMuted} />}
        onPress={() => {
          setDraft(savedUrl);
          setInvalid(false);
          setVisible(true);
        }}
      />
      {IS_ELECTRON ? (
        <InputDialog
          visible={visible}
          onClose={close}
          title={t('chats.nostr_event_url')}
          actionLayout="horizontal"
          cancelLabel={t('common.cancel')}
          confirmLabel={t('common.save')}
          onConfirm={save}
        >
          {input}
        </InputDialog>
      ) : (
        <BottomSheet
          visible={visible}
          onClose={close}
          title={t('chats.nostr_event_url')}
          inputFocusRef={inputRef}
          contentStyle={{ gap: spacing.lg }}
        >
          {input}
          <ActionRow layout="vertical" confirm={{ label: t('common.save'), onPress: save }} />
        </BottomSheet>
      )}
    </>
  );
}
