import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { ListRow } from '@/components/common/ListRow';
import { ServerSquare } from '@solar-icons/react-native/category/devices/Linear/ServerSquare';
import Plus from 'lucide-react-native/icons/plus';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { SortableUrlList } from '@/components/common/SortableUrlList';
import { DEFAULT_BLOSSOM_SERVERS, normalizeBlossomUrl } from '@/lib/nostr/blossom-url';
import {
  loadAccountMediaServers,
  saveMediaServers,
} from '@/services/files/media-server.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

export default function MediaServersPage() {
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  return <MediaServersForm key={accountPubkey} accountPubkey={accountPubkey} />;
}

function MediaServersForm({ accountPubkey }: { accountPubkey: string | null }) {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();

  const [newServer, setNewServer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const loadServers = useCallback(
    () => accountPubkey ? loadAccountMediaServers(accountPubkey) : Promise.resolve([]),
    [accountPubkey],
  );
  const { urls: servers, saveFailed, persist, loadError, retryLoad } = useSettingsAutosave(
    'blossom',
    accountPubkey ? loadServers : null,
    async (next) => { if (accountPubkey) await saveMediaServers(accountPubkey, next); },
    t('media_servers.save_error'),
  );

  function changeServers(next: string[]) {
    if (!servers || next.length === 0 || next.join('\n') === servers.join('\n')) return;
    void persist(next);
  }

  function handleAdd() {
    setError(null);
    const raw = newServer.trim();
    if (!raw || !servers) return;
    let normalized: string;
    try {
      normalized = normalizeBlossomUrl(raw);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (servers.includes(normalized)) {
      setError(t('media_servers.duplicate'));
      return;
    }
    changeServers([...servers, normalized]);
    setNewServer('');
  }

  function handleRemove(url: string) {
    if (servers) changeServers(servers.filter((s) => s !== url));
  }

  function handleAddRecommended(url: string) {
    setError(null);
    if (servers && !servers.includes(url)) changeServers([...servers, url]);
  }

  if (!accountPubkey || !servers) {
    return (
      <AppScreen edges={['bottom']}>
        {loadError && <View style={{ padding: spacing.lg, paddingTop: titleClearance + spacing.sm, gap: spacing.sm }}>
          <AppText variant="body" tone="danger">{t('error.unexpected_title')}</AppText>
          <AppButton label={t('common.retry')} onPress={retryLoad} />
        </View>}
        <ScreenHeader title={t('media_servers.title')} />
      </AppScreen>
    );
  }

  const recommendedServers = DEFAULT_BLOSSOM_SERVERS.filter((server) => !servers.includes(server));

  return (
    <AppScreen edges={['bottom']}>
      <AppFormScrollView
        {...scrollProps}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: titleClearance + spacing.sm,
          paddingBottom: spacing.xl,
          gap: spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="body" tone="muted">
          {t('media_servers.subtitle')}
        </AppText>

        {servers.length === 0 ? (
          <AppCard variant="muted" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <ServerSquare size={uiDensity.headerActionIconSize} color={c.textMuted} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <AppText variant="body" weight="medium">{t('media_servers.empty_title')}</AppText>
              <AppText variant="caption" tone="muted">
                {t('media_servers.empty_warning')}
              </AppText>
            </View>
          </AppCard>
        ) : (
          <SortableUrlList
            value={servers}
            onChange={changeServers}
            onRemove={handleRemove}
            removeDisabled={servers.length === 1}
            removeAccessibilityLabel={t('common.delete')}
          />
        )}

        <View style={{ gap: spacing.sm }}>
          <AppInput
            label={t('media_servers.add_label')}
            placeholder="https://blossom.example.com"
            value={newServer}
            onChangeText={setNewServer}
            autoCapitalize="none"
            autoCorrect={false}
            error={error ?? undefined}
            onSubmitEditing={handleAdd}
            trailingAccessory={
              <IconButton
                variant="accent"
                shape="square"
                size={uiDensity.inputHeight}
                accessibilityLabel={t('media_servers.add_label')}
                onPress={handleAdd}
                disabled={!newServer.trim()}
                icon={
                  <Plus
                    strokeWidth={iconStrokeWidth.default}
                    size={uiDensity.headerActionIconSize}
                    color={newServer.trim() ? c.accentForeground : c.textMuted}
                  />
                }
              />
            }
          />
        </View>

        {recommendedServers.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('media_servers.recommended_label')}</SectionLabel>
            {recommendedServers.map((url) => (
              <ListRow key={url} title={new URL(url).hostname}
                accessibilityRole="button"
                icon={<ServerSquare size={uiDensity.headerActionIconSize} color={c.textMuted} />}
                trailing={<Plus size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.textMuted} />}
                onPress={() => handleAddRecommended(url)} />
            ))}
          </View>
        ) : null}

        {saveFailed && <View style={{ gap: spacing.sm }}>
          <AppText variant="body" tone="danger" accessibilityLiveRegion="polite" selectable>
            {t('media_servers.save_error')}
          </AppText>
          <AppButton label={t('common.retry')} variant="secondary" onPress={() => persist(servers)} />
        </View>}
      </AppFormScrollView>
      <ScreenHeader bordered={scrolled} title={t('media_servers.title')} />
    </AppScreen>
  );
}
