import { router } from 'expo-router';
import { UsersGroupTwoRounded as UsersRound } from '@solar-icons/react-native/category/users/Linear/UsersGroupTwoRounded';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { ChromeDivider } from '@/components/common/ChromeDivider';
import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { Avatar } from '@/components/common/Avatar';
import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { EdgeFade } from '@/components/common/EdgeFade';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SelectionDot } from '@/components/common/SelectionDot';
import { useScrolled } from '@/hooks/use-scrolled';
import { useProfilesMap } from '@/hooks/use-profile';
import { abbreviateNpub, abbreviatePubkey } from '@/lib/nostr/format';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import {
  fetchNostrFollowContactCandidates,
  importNostrFollowContacts,
  type NostrFollowContactCandidate,
} from '@/services/contact/contact.service';
import { showToast } from '@/stores/toast.store';
import { useActiveAccount } from '@/stores/active-account.store';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

type LoadState = 'loading' | 'ready' | 'error';

const FADE_H = 24;

function npubAbbrev(pubkey: string): string {
  try {
    return abbreviateNpub(pubkeyToNpub(pubkey));
  } catch {
    return abbreviatePubkey(pubkey);
  }
}

function ImportCandidateRow({
  pubkey,
  displayName,
  secondaryName,
  picture,
  selected,
  alreadyContact,
  onPress,
}: {
  pubkey: string;
  displayName: string;
  secondaryName: string | null;
  picture: string | null;
  selected: boolean;
  alreadyContact: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      pressFeedback="delayed"
      disabled={alreadyContact}
      style={({ pressed }) => ({
        height: uiDensity.contactRowHeight,
        paddingHorizontal: spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: pressed ? c.interactionOverlay : 'transparent',
        opacity: alreadyContact ? 0.68 : 1,
      })}
    >
      <View style={{ width: 22, alignItems: 'center' }}>
        {alreadyContact ? null : <SelectionDot selected={selected} />}
      </View>
      <Avatar
        pubkey={pubkey}
        picture={picture}
        name={displayName}
        size={uiDensity.contactAvatarSize}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="subtitle" numberOfLines={1}>
          {displayName}
        </AppText>
        {secondaryName ? (
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {secondaryName}
          </AppText>
        ) : null}
      </View>
      {alreadyContact ? (
        <AppText variant="caption" tone="muted">
          {t('import_contacts.already_added')}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export default function ImportNostrContacts() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const [state, setState] = useState<LoadState>('loading');
  const [candidates, setCandidates] = useState<NostrFollowContactCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [importing, setImporting] = useState(false);

  async function loadCandidates() {
    if (!accountPubkey) return;
    setState('loading');
    try {
      const next = await fetchNostrFollowContactCandidates(accountPubkey);
      setCandidates(next);
      setSelected(new Set());
      setState('ready');
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void loadCandidates(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountPubkey]);

  const pubkeys = useMemo(() => candidates.map((c) => c.pubkey), [candidates]);
  const profiles = useProfilesMap(pubkeys);
  const rows = useMemo(
    () =>
      candidates.map((candidate) => {
        const profile = profiles[candidate.pubkey];
        const profileName = profile?.displayName || profile?.name || null;
        const displayName = profileName ?? candidate.petname ?? npubAbbrev(candidate.pubkey);
        const secondaryName =
          profileName && candidate.petname && profileName !== candidate.petname
            ? candidate.petname
            : null;
        return {
          ...candidate,
          displayName,
          secondaryName,
          picture: profile?.picture ?? null,
        };
      }),
    [candidates, profiles],
  );
  const selectedCount = selected.size;
  const importableCount = candidates.filter((c) => !c.alreadyContact).length;
  const allImportableSelected = importableCount > 0 && selectedCount === importableCount;

  function toggle(pubkey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });
  }

  function toggleAll() {
    if (allImportableSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(candidates.filter((c) => !c.alreadyContact).map((c) => c.pubkey)));
  }

  async function importSelected() {
    if (!accountPubkey || selected.size === 0 || importing) return;
    setImporting(true);
    try {
      const result = await importNostrFollowContacts(accountPubkey, Array.from(selected));
      showToast(t('import_contacts.imported_count', { count: result.imported }));
      router.replace('/contacts');
    } catch {
      showToast(t('import_contacts.failed'));
    } finally {
      setImporting(false);
    }
  }

  const empty = state === 'ready' && candidates.length === 0;
  const allAdded = state === 'ready' && candidates.length > 0 && importableCount === 0;

  return (
    <AppScreen edges={['bottom']}>
      {state === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: titleClearance }}>
          <ActivityIndicator color={c.textMuted} />
        </View>
      ) : state === 'error' ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            paddingTop: titleClearance,
            gap: spacing.md,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.full,
              backgroundColor: c.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <UsersRound size={28} color={c.textMuted} />
          </View>
          <AppText variant="subtitle" tone="muted" align="center">
            {t('import_contacts.failed_title')}
          </AppText>
          <AppText variant="body" tone="muted" align="center">
            {t('import_contacts.failed_hint')}
          </AppText>
          <AppButton
            label={t('import_contacts.retry')}
            variant="secondary"
            fullWidth={false}
            onPress={() => void loadCandidates()}
          />
        </View>
      ) : empty ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            paddingTop: titleClearance,
            gap: spacing.md,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.full,
              backgroundColor: c.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <UsersRound size={28} color={c.textMuted} />
          </View>
          <AppText variant="subtitle" tone="muted" align="center">
            {t('import_contacts.empty_title')}
          </AppText>
          <AppText variant="body" tone="muted" align="center">
            {t('import_contacts.empty_hint')}
          </AppText>
        </View>
      ) : (
        <>
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: titleClearance, paddingBottom: spacing.sm }}>
            <AppText variant="body" tone="muted">
              {allAdded
                ? t('import_contacts.all_added_hint')
                : t('import_contacts.subtitle')}
            </AppText>
          </View>
          <View style={{ flex: 1, position: 'relative' }}>
            <FlatList
              {...scrollProps}
              data={rows}
              keyExtractor={(item) => item.pubkey}
              renderItem={({ item }) => (
                <ImportCandidateRow
                  pubkey={item.pubkey}
                  displayName={item.displayName}
                  secondaryName={item.secondaryName}
                  picture={item.picture}
                  selected={selected.has(item.pubkey)}
                  alreadyContact={item.alreadyContact}
                  onPress={() => toggle(item.pubkey)}
                />
              )}
              contentContainerStyle={{ paddingTop: FADE_H, paddingBottom: FADE_H }}
              showsVerticalScrollIndicator={false}
            />
            <EdgeFade edge="top" color={c.background} height={FADE_H} />
            <EdgeFade edge="bottom" color={c.background} height={FADE_H} />
            <ChromeDivider visible={scrolled} edge="top" />
          </View>
          <View style={{ padding: spacing.lg }}>
            <AppButton
              label={t('import_contacts.import_selected', { count: selectedCount })}
              variant="primary"
              size="lg"
              loading={importing}
              disabled={selectedCount === 0 || allAdded}
              onPress={() => void importSelected()}
            />
          </View>
        </>
      )}
      <ScreenHeader
        title={t('import_contacts.title')}
        right={
          state === 'ready' && !empty && !allAdded ? (
            <AppButton
              label={
                allImportableSelected
                  ? t('import_contacts.clear_selection')
                  : t('import_contacts.select_all')
              }
              variant="text"
              corner="full"
              fullWidth={false}
              onPress={toggleAll}
            />
          ) : null
        }
      />
    </AppScreen>
  );
}
