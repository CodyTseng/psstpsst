import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, StyleSheet, View } from 'react-native';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import Plus from 'lucide-react-native/icons/plus';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { SortableUrlList } from '@/components/common/SortableUrlList';
import { normalizeRelayUrl } from '@/lib/nostr/relay-url';
import { buildSigner } from '@/services/account/account.service';
import { dmService } from '@/services/dm/dm.service';
import {
  loadAccountDmRelays,
  loadAccountWriteRelays,
  saveAndPublishWriteRelays,
  saveAndPublishDmRelays,
} from '@/services/relay/relay-list.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type RelayMode = 'dm' | 'write';

export function RelaySettingsScreen() {
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  return <RelaySettingsTabs key={accountPubkey} accountPubkey={accountPubkey} />;
}

function RelaySettingsTabs({ accountPubkey }: { accountPubkey: string | null }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const [mode, setMode] = useState<RelayMode>('dm');
  const [visitedWrite, setVisitedWrite] = useState(false);
  const dmScroll = useScrolled();
  const writeScroll = useScrolled();
  const scrolled = (mode === 'dm' ? dmScroll : writeScroll).scrolled;

  return (
    <AppScreen edges={['bottom']}>
      <View style={{ paddingTop: titleClearance + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <SegmentedControl
          value={mode}
          options={[
            { value: 'dm', label: t('relays.title') },
            { value: 'write', label: t('relays.write_title') },
          ]}
          onChange={(next) => {
            Keyboard.dismiss();
            if (next === 'write') setVisitedWrite(true);
            setMode(next);
          }}
        />
        {scrolled && <View style={{ position: 'absolute', bottom: 0, start: 0, end: 0, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />}
      </View>
      <View testID="relay-panel-dm" style={{ flex: 1, display: mode === 'dm' ? 'flex' : 'none' }}>
        <RelaySettingsForm mode="dm" accountPubkey={accountPubkey} scrollProps={dmScroll.scrollProps} />
      </View>
      {visitedWrite && (
        <View testID="relay-panel-write" style={{ flex: 1, display: mode === 'write' ? 'flex' : 'none' }}>
          <RelaySettingsForm mode="write" accountPubkey={accountPubkey} scrollProps={writeScroll.scrollProps} />
        </View>
      )}
      <ScreenHeader title={t('relays.page_title')} />
    </AppScreen>
  );
}

function RelaySettingsForm({ mode, accountPubkey, scrollProps }: {
  mode: RelayMode;
  accountPubkey: string | null;
  scrollProps: ReturnType<typeof useScrolled>['scrollProps'];
}) {
  const { t } = useTranslation();
  const c = useThemeColors();

  const [relays, setRelays] = useState<string[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [newRelay, setNewRelay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedAccountPubkey, setLoadedAccountPubkey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!accountPubkey) return;
    let mounted = true;
    const load = mode === 'write' ? loadAccountWriteRelays : loadAccountDmRelays;
    void load(accountPubkey).then((list) => {
      if (!mounted) return;
      setRelays(list);
      setOriginal(list);
      setLoadedAccountPubkey(accountPubkey);
    }).catch((error: unknown) => {
      if (mounted) setLoadError(String(error instanceof Error ? error.message : error));
    });
    return () => {
      mounted = false;
    };
  }, [accountPubkey, mode, loadAttempt]);

  const dirty = relays.join(',') !== original.join(',');
  const canSave = dirty && relays.length > 0 && !saving;

  function handleAdd() {
    setError(null);
    const raw = newRelay.trim();
    if (!raw || saving) return;
    let normalized: string;
    try {
      normalized = normalizeRelayUrl(raw.startsWith('ws') ? raw : `wss://${raw}`);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (relays.includes(normalized)) {
      setError(t('relays.duplicate'));
      return;
    }
    setRelays([...relays, normalized]);
    setNewRelay('');
  }

  function handleRemove(url: string) {
    if (!saving) setRelays(relays.filter((r) => r !== url));
  }

  async function handleSave() {
    if (!accountPubkey || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const signer = await buildSigner(accountPubkey);
      if (useActiveAccount.getState().activePubkey !== accountPubkey) return;
      if (mode === 'write') {
        await saveAndPublishWriteRelays({ accountPubkey, signer, relays });
      } else {
        await saveAndPublishDmRelays({ accountPubkey, signer, relays });
      }

      if (useActiveAccount.getState().activePubkey !== accountPubkey) return;
      dmService.refreshRelayConfiguration(accountPubkey);
      setOriginal(relays);
    } catch (e) {
      setError(mode === 'write' ? t('relays.write_save_error') : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!accountPubkey || loadedAccountPubkey !== accountPubkey) {
    return (
      <View>
        {loadError && (
          <View style={{ padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg }}>
            <AppText variant="body" tone="danger" selectable>{loadError}</AppText>
            <AppButton label={t('common.retry')} onPress={() => {
              setLoadError(null);
              setLoadAttempt((attempt) => attempt + 1);
            }} />
          </View>
        )}
      </View>
    );
  }

  return (
    <AppFormScrollView
      {...scrollProps}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing['2xl'],
        gap: spacing.xl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <AppText variant="body" tone="muted">
        {t(mode === 'write' ? 'relays.write_subtitle' : 'relays.subtitle')}
      </AppText>

      {relays.length === 0 ? (
        <AppCard variant="muted">
          <Plus size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.textMuted} />
          <AppText variant="subtitle">{t('relays.add_label')}</AppText>
          <AppText variant="body" tone="warning">
            {t(mode === 'write' ? 'relays.write_empty_warning' : 'relays.empty_warning')}
          </AppText>
        </AppCard>
      ) : (
        <SortableUrlList
          value={relays}
          onChange={(next) => { if (!saving) setRelays(next); }}
          onRemove={handleRemove}
          removeAccessibilityLabel={t('common.delete')}
        />
      )}

      <View style={{ gap: spacing.sm }}>
        <AppInput
          label={t('relays.add_label')}
          placeholder="wss://server.example.com"
          value={newRelay}
          onChangeText={setNewRelay}
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
              accessibilityLabel={t('relays.add_label')}
              onPress={handleAdd}
              disabled={saving || !newRelay.trim()}
              icon={
                <Plus
                  strokeWidth={iconStrokeWidth.default}
                  size={uiDensity.headerActionIconSize}
                  color={newRelay.trim() ? c.accentForeground : c.textMuted}
                />
              }
            />
          }
        />
      </View>

      <View style={{ height: spacing.sm }} />

      <AppButton
        label={t('relays.save')}
        variant="primary"
        size="lg"
        loading={saving}
        disabled={!canSave}
        onPress={handleSave}
      />
    </AppFormScrollView>
  );
}
