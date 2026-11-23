import { useCallback, useState } from 'react';
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
import { dmService } from '@/services/dm/dm.service';
import {
  loadAccountDmRelays,
  loadLocalWriteRelays,
  saveWriteRelays,
  saveDmRelays,
} from '@/services/relay/relay-list.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

import { DEFAULT_DISCOVERY_RELAYS, loadDiscoveryRelays, saveDiscoveryRelays } from '@/services/explore/discovery-relays';
import { refreshDiscoverySources } from '@/services/explore/discovery';

type RelayMode = 'dm' | 'write' | 'napp' | 'napplet';

export function RelaySettingsScreen({ initialDmRelay = '' }: { initialDmRelay?: string }) {
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  return <RelaySettingsTabs key={accountPubkey} accountPubkey={accountPubkey} initialDmRelay={initialDmRelay} />;
}

function RelaySettingsTabs({ accountPubkey, initialDmRelay }: { accountPubkey: string | null; initialDmRelay: string }) {
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
        <RelaySettingsForm mode="dm" accountPubkey={accountPubkey} initialRelay={initialDmRelay} scrollProps={dmScroll.scrollProps} />
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

export function RelaySettingsForm({ mode, accountPubkey, scrollProps, initialRelay = '' }: {
  initialRelay?: string;
  mode: RelayMode;
  accountPubkey: string | null;
  scrollProps: ReturnType<typeof useScrolled>['scrollProps'];
}) {
  const { t } = useTranslation();
  const c = useThemeColors();

  const discoveryFormat = mode === 'napp' || mode === 'napplet' ? mode : undefined;
  const [newRelay, setNewRelay] = useState(initialRelay);
  const [error, setError] = useState<string | null>(null);
  const loadRelays = useCallback(async () => {
    if (!accountPubkey) return [];
    if (discoveryFormat) return (await loadDiscoveryRelays())[discoveryFormat];
    return (mode === 'write' ? loadLocalWriteRelays : loadAccountDmRelays)(accountPubkey);
  }, [accountPubkey, discoveryFormat, mode]);
  const { urls: relays, saveFailed, persist, loadError, retryLoad } = useSettingsAutosave(
    discoveryFormat ? 'discovery' : mode === 'write' ? 'write' : 'dm',
    accountPubkey ? loadRelays : null,
    async (next) => {
      if (!accountPubkey) return;
      if (discoveryFormat) {
        await saveDiscoveryRelays(discoveryFormat, next);
        refreshDiscoverySources(useActiveAccount.getState().activePubkey ?? accountPubkey);
      } else {
        await (mode === 'write' ? saveWriteRelays : saveDmRelays)(accountPubkey, next);
        dmService.refreshRelayConfiguration(accountPubkey);
      }
    },
    t('relays.save_error'),
  );

  function changeRelays(next: string[]) {
    if (!relays || (!discoveryFormat && next.length === 0) || next.join('\n') === relays.join('\n')) return;
    void persist(next);
  }

  function handleAdd() {
    setError(null);
    const raw = newRelay.trim();
    if (!raw || !relays) return;
    let normalized: string;
    try {
      normalized = normalizeRelayUrl(raw);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (relays.includes(normalized)) {
      setError(t('relays.duplicate'));
      return;
    }
    changeRelays([...relays, normalized]);
    setNewRelay('');
  }

  function handleRemove(url: string) {
    if (relays) changeRelays(relays.filter((r) => r !== url));
  }

  if (!accountPubkey || !relays) {
    return (
      <View>
        {loadError && (
          <View style={{ padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg }}>
            <AppText variant="body" tone="danger" selectable>{loadError.message}</AppText>
            <AppButton label={t('common.retry')} onPress={retryLoad} />
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
      <AppText variant={discoveryFormat ? 'caption' : 'body'} tone="muted">
        {t(discoveryFormat ? 'applications.discovery_relays_subtitle' : mode === 'write' ? 'relays.write_subtitle' : 'relays.subtitle')}
      </AppText>

      <View style={{ gap: discoveryFormat ? spacing.lg : spacing.xl }}>
        {discoveryFormat && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
          <AppText variant="subtitle">{t('relays.page_title')}</AppText>
          <AppButton
            label={t('common.reset')}
            variant="text"
            labelVariant="caption"
            compactAxis="none"
            disabled={relays.join(',') === DEFAULT_DISCOVERY_RELAYS[discoveryFormat].join(',')}
            onPress={() => changeRelays([...DEFAULT_DISCOVERY_RELAYS[discoveryFormat]])}
          />
        </View>}
        {relays.length === 0 ? (
          <AppCard variant="muted">
            <Plus size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.textMuted} />
            <AppText variant="subtitle">{t('relays.add_label')}</AppText>
            <AppText variant="body" tone="warning">
              {t(discoveryFormat ? 'applications.discovery_relays_subtitle' : mode === 'write' ? 'relays.write_empty_warning' : 'relays.empty_warning')}
            </AppText>
          </AppCard>
        ) : (
          <SortableUrlList
            value={relays}
            onChange={changeRelays}
            onRemove={handleRemove}
            removeDisabled={!discoveryFormat && relays.length === 1}
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
            error={error ?? undefined}
            onSubmitEditing={handleAdd}
            trailingAccessory={
              <IconButton
                variant="accent"
                shape="square"
                size={uiDensity.inputHeight}
                accessibilityLabel={t('relays.add_label')}
                onPress={handleAdd}
                disabled={!newRelay.trim()}
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

      </View>

      {saveFailed && <View style={{ gap: spacing.sm }}>
        <AppText variant="body" tone="danger" accessibilityLiveRegion="polite" selectable>
          {t('relays.save_error')}
        </AppText>
        <AppButton label={t('common.retry')} variant="secondary" onPress={() => persist(relays)} />
      </View>}
    </AppFormScrollView>
  );
}
