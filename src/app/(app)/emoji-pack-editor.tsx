import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { EmojiPackSkeleton } from '@/components/emoji/EmojiPackCard';
import { StandaloneEmojiGrid } from '@/components/emoji/standalone-emoji-grid';
import { useAddCustomEmoji } from '@/hooks/use-add-custom-emoji';
import { useScrolled } from '@/hooks/use-scrolled';
import { KEYBOARD_AVOIDING_BEHAVIOR } from '@/lib/platform';
import {
  isValidEmojiShortcode,
  isValidEmojiUrl,
  MAX_EMOJIS_PER_PACK,
  normalizeEmojiShortcode,
  type CustomEmoji,
  type EmojiPack,
} from '@/lib/nostr/custom-emoji';
import { platform } from '@/platform';
import type { UploadedEmojiDraft } from '@/services/emoji/custom-emoji-image-handoff';
import { getEmojiPack, saveEmojiPack } from '@/services/emoji/custom-emoji.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing } from '@/theme';

type DraftEmoji = {
  id: string;
  shortcode: string;
  uri: string;
};

type PackNameFieldProps = {
  initialValue: string;
  onChange: (value: string) => void;
};

const PackNameField = memo(function PackNameField({
  initialValue,
  onChange,
}: PackNameFieldProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);

  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <AppInput
        label={t('emoji.pack_name')}
        value={value}
        onChangeText={(next) => {
          setValue(next);
          onChange(next);
        }}
        maxLength={80}
        placeholder={t('emoji.pack_name_placeholder')}
      />
    </View>
  );
});

function uniqueShortcode(base: string, used: ReadonlySet<string>): string {
  const bounded = base.slice(0, 64);
  if (!used.has(bounded.toLowerCase())) return bounded;
  for (let index = 2; ; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${bounded.slice(0, 64 - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

function incomingDraft(shortcode?: string, url?: string): DraftEmoji | null {
  const normalized = normalizeEmojiShortcode(shortcode ?? '');
  if (!isValidEmojiShortcode(normalized) || !url || !isValidEmojiUrl(url)) return null;
  return {
    id: `received:${normalized}:${url}`,
    shortcode: normalized,
    uri: url,
  };
}

function appendIncomingEmoji(
  drafts: DraftEmoji[],
  incoming: DraftEmoji | null,
): DraftEmoji[] {
  if (!incoming) return drafts;
  if (
    drafts.some(
      (draft) =>
        draft.shortcode.toLowerCase() === incoming.shortcode.toLowerCase() &&
        draft.uri === incoming.uri,
    )
  ) {
    return drafts;
  }
  const shortcode = uniqueShortcode(
    incoming.shortcode,
    new Set(drafts.map((draft) => draft.shortcode.toLowerCase())),
  );
  return [...drafts, { ...incoming, id: `${incoming.id}:${shortcode}`, shortcode }];
}

function emojiKey(emoji: Pick<CustomEmoji, 'shortcode' | 'url'>): string {
  return JSON.stringify([emoji.shortcode.toLowerCase(), emoji.url]);
}

function ignoreEmojiSelection() {}

export default function EmojiPackEditorScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const titleClearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();
  const { coordinate, emojiShortcode, emojiUrl } = useLocalSearchParams<{
    coordinate?: string;
    emojiShortcode?: string;
    emojiUrl?: string;
  }>();
  const receivedEmoji = useMemo(
    () => incomingDraft(emojiShortcode, emojiUrl),
    [emojiShortcode, emojiUrl],
  );
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const titleRef = useRef('');
  const [existing, setExisting] = useState<EmojiPack | undefined>();
  const [emojis, setEmojis] = useState<DraftEmoji[]>(() =>
    appendIncomingEmoji([], receivedEmoji),
  );
  const [loading, setLoading] = useState(!!coordinate);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!coordinate) return;
    let active = true;
    void getEmojiPack(coordinate)
      .then((pack) => {
        if (!active) return;
        if (pack && pack.authorPubkey === accountPubkey) {
          titleRef.current = pack.title;
          setExisting(pack);
          setEmojis(
            appendIncomingEmoji(
              pack.emojis.map((emoji, index) => ({
                id: `${index}:${emoji.shortcode}:${emoji.url}`,
                shortcode: emoji.shortcode,
                uri: emoji.url,
              })),
              receivedEmoji,
            ),
          );
        } else setUnavailable(true);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setUnavailable(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [accountPubkey, coordinate, receivedEmoji]);

  const customEmojis = useMemo<CustomEmoji[]>(
    () =>
      emojis.map((emoji) => ({
        shortcode: emoji.shortcode,
        url: emoji.uri,
      })),
    [emojis],
  );

  const updateTitle = useCallback((value: string) => {
    titleRef.current = value;
  }, []);

  const titleField = useMemo(
    () => (
      <PackNameField
        key={existing?.event.id ?? 'new-pack'}
        initialValue={existing?.title ?? ''}
        onChange={updateTitle}
      />
    ),
    [existing?.event.id, existing?.title, updateTitle],
  );

  const addUploadedEmoji = useCallback((draft: UploadedEmojiDraft) => {
    setEmojis((current) => [
      ...current,
      {
        id: `${Date.now()}:${draft.shortcode}:${draft.url}`,
        shortcode: draft.shortcode,
        uri: draft.url,
      },
    ]);
  }, []);

  const draftTarget = useMemo(
    () => ({
      existingShortcodes: customEmojis.map((emoji) => emoji.shortcode),
      onComplete: addUploadedEmoji,
    }),
    [addUploadedEmoji, customEmojis],
  );
  const addCustomEmoji = useAddCustomEmoji(draftTarget);

  const addEmoji = useCallback(async () => {
    if (emojis.length >= MAX_EMOJIS_PER_PACK) {
      void platform.confirmationDialog.notify({
        title: t('emoji.pack_full'),
        okLabel: t('common.ok'),
      });
      return;
    }
    await addCustomEmoji();
  }, [addCustomEmoji, emojis.length, t]);

  const removeEmoji = useCallback((target: CustomEmoji) => {
    setEmojis((current) =>
      current.filter(
        (emoji) =>
          emojiKey({ shortcode: emoji.shortcode, url: emoji.uri }) !==
          emojiKey(target),
      ),
    );
  }, []);

  const renameEmoji = useCallback((target: CustomEmoji, shortcode: string) => {
    setEmojis((current) =>
      current.map((emoji) =>
        emojiKey({ shortcode: emoji.shortcode, url: emoji.uri }) ===
        emojiKey(target)
          ? { ...emoji, shortcode }
          : emoji,
      ),
    );
  }, []);

  const reorderEmojis = useCallback((ordered: CustomEmoji[]) => {
    setEmojis((current) => {
      const byKey = new Map(
        current.map((emoji) => [
          emojiKey({ shortcode: emoji.shortcode, url: emoji.uri }),
          emoji,
        ]),
      );
      return ordered
        .map((emoji) => byKey.get(emojiKey(emoji)))
        .filter((emoji): emoji is DraftEmoji => !!emoji);
    });
  }, []);

  function beginSave() {
    if (saving || !accountPubkey) return;
    const title = titleRef.current.trim();
    const normalized = emojis.map((emoji) => ({
      ...emoji,
      shortcode: normalizeEmojiShortcode(emoji.shortcode),
    }));
    const seen = new Set<string>();
    if (!title) {
      void platform.confirmationDialog.notify({
        title: t('emoji.name_required'),
        okLabel: t('common.ok'),
      });
      return;
    }
    if (normalized.length === 0) {
      void platform.confirmationDialog.notify({
        title: t('emoji.add_one_required'),
        okLabel: t('common.ok'),
      });
      return;
    }
    for (const emoji of normalized) {
      const key = emoji.shortcode.toLowerCase();
      if (!isValidEmojiShortcode(emoji.shortcode)) {
        void platform.confirmationDialog.notify({
          title: t('emoji.invalid_shortcode'),
          okLabel: t('common.ok'),
        });
        return;
      }
      if (seen.has(key)) {
        void platform.confirmationDialog.notify({
          title: t('emoji.duplicate_shortcode'),
          okLabel: t('common.ok'),
        });
        return;
      }
      seen.add(key);
    }
    setEmojis(normalized);
    setSaving(true);
    setTimeout(() => void persist(accountPubkey, title, normalized), 0);
  }

  async function persist(
    pubkey: string,
    title: string,
    drafts: DraftEmoji[],
  ) {
    try {
      const pack = await saveEmojiPack({
        accountPubkey: pubkey,
        title,
        emojis: drafts.map((emoji) => ({
          shortcode: emoji.shortcode,
          url: emoji.uri,
        })),
        existing,
      });
      router.replace({
        pathname: '/emoji-pack/[coordinate]',
        params: { coordinate: pack.coordinate },
      });
    } catch {
      void platform.confirmationDialog.notify({
        title: t('emoji.publish_failed'),
        okLabel: t('common.ok'),
      });
      setSaving(false);
    }
  }

  return (
    <AppScreen edges={[]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={KEYBOARD_AVOIDING_BEHAVIOR}
      >
        {unavailable ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
              padding: spacing['2xl'],
              paddingTop: titleClearance + spacing['2xl'],
            }}
          >
            <AppText variant="subtitle" weight="semibold">
              {t('emoji.pack_unavailable')}
            </AppText>
            <AppText tone="muted" align="center">
              {t('emoji.pack_unavailable_hint')}
            </AppText>
            <AppButton
              label={t('common.back')}
              variant="primary"
              fullWidth={false}
              onPress={() => router.back()}
            />
          </View>
        ) : !loading ? (
          <StandaloneEmojiGrid
            active
            emojis={customEmojis}
            editing
            doneActionInGrid={false}
            listHeader={titleField}
            onAdd={() => void addEmoji()}
            onRemoveEmoji={removeEmoji}
            onRenameEmoji={renameEmoji}
            onReorderEmojis={reorderEmojis}
            onSelect={ignoreEmojiSelection}
            onScroll={scrollProps.onScroll}
            removalContext="pack"
            scrollEventThrottle={scrollProps.scrollEventThrottle}
            safeBottom={insets.bottom}
            contentTopInset={titleClearance}
          />
        ) : (
          <View style={{ padding: spacing.lg, paddingTop: titleClearance + spacing.lg }}>
            <EmojiPackSkeleton />
          </View>
        )}
      </KeyboardAvoidingView>
      <ScreenHeader
        bordered={scrolled}
        title={existing ? t('emoji.edit_pack') : t('emoji.create_pack')}
        right={
          !loading && !unavailable ? (
            <AppButton
              label={t('common.save')}
              variant="text"
              loading={saving}
              onPress={beginSave}
            />
          ) : undefined
        }
      />
    </AppScreen>
  );
}
