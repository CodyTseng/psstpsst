import { useEffect, useRef, useState } from 'react';
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
import { buildSigner } from '@/services/account/account-access';
import type { Signer } from '@/services/signer/signer.interface';
import {
  loadAccountMediaServers,
  saveAndPublishMediaServers,
} from '@/services/files/media-server.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { showToast } from '@/stores/toast.store';
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

  const [servers, setServers] = useState<string[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [newServer, setNewServer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveAbort = useRef<AbortController | null>(null);
  const [loadedAccountPubkey, setLoadedAccountPubkey] = useState<string | null>(null);

  useEffect(() => () => { saveAbort.current?.abort(); }, []);

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
    if (!raw || saving) return;
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
    setServers([...servers, normalized]);
    setNewServer('');
  }

  function handleRemove(url: string) {
    if (!saving) setServers(servers.filter((s) => s !== url));
  }

  function handleAddRecommended(url: string) {
    if (saving) return;
    setError(null);
    setServers((current) => (current.includes(url) ? current : [...current, url]));
  }

  async function handleSave() {
    if (!accountPubkey || !canSave || saveAbort.current) return;
    const abort = new AbortController();
    saveAbort.current = abort;
    setSaving(true);
    setError(null);
    setSaveError(null);
    let signer: Signer | undefined;
    try {
      signer = await buildSigner(accountPubkey);
      if (useActiveAccount.getState().activePubkey !== accountPubkey || abort.signal.aborted) return;
      await saveAndPublishMediaServers({ accountPubkey, signer, servers, abort: abort.signal });
      if (useActiveAccount.getState().activePubkey !== accountPubkey || abort.signal.aborted) return;
      setOriginal(servers);
      showToast(t('media_servers.save_success'), { target: 'detail' });
    } catch {
      if (useActiveAccount.getState().activePubkey !== accountPubkey || abort.signal.aborted) return;
      const message = t('media_servers.save_error');
      setSaveError(message);
      showToast(message, { variant: 'error', target: 'detail' });
    } finally {
      saveAbort.current = null;
      setSaving(false);
      try { await signer?.destroy?.(); } catch { /* Publication already settled. */ }
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
          <AppCard variant="muted">
            <Plus size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.textMuted} />
            <AppText variant="subtitle">{t('media_servers.add_label')}</AppText>
            <AppText variant="body" tone="warning">
              {t('media_servers.empty_warning')}
            </AppText>
          </AppCard>
        ) : (
          <SortableUrlList
            value={servers}
            onChange={(next) => { if (!saving) setServers(next); }}
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
                  iconLeft={<Plus strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text} />}
                  disabled={saving}
                  onPress={() => handleAddRecommended(url)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <AppInput
            label={t('media_servers.add_label')}
            placeholder="https://blossom.example.com"
            value={newServer}
            onChangeText={setNewServer}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
            error={error ?? undefined}
            onSubmitEditing={handleAdd}
            trailingAccessory={
              <IconButton
                variant="accent"
                shape="square"
                size={uiDensity.inputHeight}
                accessibilityLabel={t('media_servers.add_label')}
                onPress={handleAdd}
                disabled={saving || !newServer.trim()}
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

        <View style={{ height: spacing.sm }} />

        <View style={{ gap: spacing.sm }}>
          {saveError && (
            <AppText variant="body" tone="danger" accessibilityLiveRegion="polite" selectable>{saveError}</AppText>
          )}
          <AppButton
            label={t('media_servers.save')}
            variant="primary"
            size="lg"
            loading={saving}
            disabled={!canSave}
            onPress={handleSave}
          />
        </View>
      </AppFormScrollView>
      <ScreenHeader bordered={scrolled} title={t('media_servers.title')} />
    </AppScreen>
  );
}
