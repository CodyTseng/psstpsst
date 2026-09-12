import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import Plus from 'lucide-react-native/icons/plus';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { SortableUrlList } from '@/components/common/SortableUrlList';
import { DEFAULT_BLOSSOM_SERVERS, normalizeBlossomUrl } from '@/lib/nostr/blossom-url';
import { buildSigner } from '@/services/account/account.service';
import {
  loadAccountMediaServers,
  saveAndPublishMediaServers,
} from '@/services/files/media-server.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

export default function MediaServersPage() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);

  const [servers, setServers] = useState<string[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [newServer, setNewServer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedAccountPubkey, setLoadedAccountPubkey] = useState<string | null>(null);

  useEffect(() => {
    if (!accountPubkey) return;
    let mounted = true;
    void loadAccountMediaServers(accountPubkey).then((list) => {
      if (!mounted) return;
      setServers(list);
      setOriginal(list);
      setLoadedAccountPubkey(accountPubkey);
    });
    return () => {
      mounted = false;
    };
  }, [accountPubkey]);

  const dirty = servers.join(',') !== original.join(',');
  const canSave = dirty && servers.length > 0 && !saving;
  const recommendedServers = DEFAULT_BLOSSOM_SERVERS.filter((server) => !servers.includes(server));

  function handleAdd() {
    setError(null);
    const raw = newServer.trim();
    if (!raw) return;
    let normalized: string;
    try {
      normalized = normalizeBlossomUrl(raw.startsWith('http') ? raw : `https://${raw}`);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (servers.includes(normalized)) {
      setError(t('media_servers.duplicate'));
      return;
    }
    setServers([...servers, normalized]);
    setNewServer('');
  }

  function handleRemove(url: string) {
    setServers(servers.filter((s) => s !== url));
  }

  function handleAddRecommended(url: string) {
    setError(null);
    setServers((current) => (current.includes(url) ? current : [...current, url]));
  }

  async function handleSave() {
    if (!accountPubkey) return;
    setSaving(true);
    setError(null);
    try {
      const signer = await buildSigner(accountPubkey);
      await saveAndPublishMediaServers({ accountPubkey, signer, servers });
      setOriginal(servers);
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!accountPubkey || loadedAccountPubkey !== accountPubkey) {
    return (
      <AppScreen edges={['bottom']}>
        <ScreenHeader title={t('media_servers.title')} />
      </AppScreen>
    );
  }

  return (
    <AppScreen edges={['bottom']}>
      <AppFormScrollView
        {...scrollProps}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: titleClearance + spacing.sm,
          paddingBottom: 24,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="body" tone="muted">
          {t('media_servers.subtitle')}
        </AppText>

        {servers.length === 0 ? (
          <AppCard variant="muted">
            <AppText variant="body" tone="warning">
              {t('media_servers.empty_warning')}
            </AppText>
          </AppCard>
        ) : (
          <SortableUrlList
            value={servers}
            onChange={setServers}
            onRemove={handleRemove}
            removeAccessibilityLabel={t('common.delete')}
          />
        )}

        {recommendedServers.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <SectionLabel>{t('media_servers.recommended_label')}</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {recommendedServers.map((url) => (
                <AppButton
                  key={url}
                  label={new URL(url).hostname}
                  variant="secondary"
                  size="sm"
                  labelVariant="code"
                  corner="full"
                  fullWidth={false}
                  iconLeft={<Plus strokeWidth={iconStrokeWidth.default} size={16} color={c.text} />}
                  onPress={() => handleAddRecommended(url)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <AppInput
            label={t('media_servers.add_label')}
            placeholder="https://blossom.example.com"
            value={newServer}
            onChangeText={setNewServer}
            autoCapitalize="none"
            autoCorrect={false}
            error={newServer !== '' ? error ?? undefined : undefined}
            onSubmitEditing={handleAdd}
            trailingAccessory={
              <IconButton
                variant="accent"
                shape="square"
                size={uiDensity.inputHeight}
                onPress={handleAdd}
                disabled={!newServer.trim()}
                icon={
                  <Plus
                    strokeWidth={iconStrokeWidth.default}
                    size={20}
                    color={newServer.trim() ? c.accentForeground : c.textMuted}
                  />
                }
              />
            }
          />
        </View>

        <View style={{ height: 8 }} />

        <AppButton
          label={t('media_servers.save')}
          variant="primary"
          size="lg"
          loading={saving}
          disabled={!canSave}
          onPress={handleSave}
        />
      </AppFormScrollView>
      <ScreenHeader bordered={scrolled} title={t('media_servers.title')} />
    </AppScreen>
  );
}
