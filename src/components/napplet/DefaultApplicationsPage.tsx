import Check from 'lucide-react-native/icons/check';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { iconStrokeWidth } from '@/theme/icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';
import { Widget } from '@solar-icons/react-native/category/settings/Linear/Widget';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { DelayedActivityIndicator } from '@/components/common/DelayedActivityIndicator';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useDefaultHandlerApplication } from '@/hooks/use-default-handler-application';
import type { DefaultHandler } from '@/services/explore/default-handlers';
import { ApplicationIcon } from './ApplicationIcon';
import { useDefaultHandlers } from '@/hooks/use-default-handlers';
import { useScrolled } from '@/hooks/use-scrolled';
import { applicationListEntry } from '@/services/explore/model';
import type { RuntimePromptChoice } from '@/services/napplet/runtime';
import { useApplicationChoices, type ApplicationChoiceRequest } from '@/hooks/use-application-choices';
import { ApplicationChoiceSectionHeader } from './application-choice-section-header';
import { applicationChoiceFooter } from './application-choice-footer';
import { spacing, useThemeColors } from '@/theme';
import { ApplicationListRow } from './ApplicationListRow';

export function DefaultApplicationsPage({ account }: { account: string }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const bottomInset = useSafeAreaInsets().bottom;
  const { scrolled, scrollProps } = useScrolled();
  const defaults = useDefaultHandlers(account);
  const request = useMemo<ApplicationChoiceRequest | null>(() => {
    if (!defaults.selected || !defaults.candidates.loaded || defaults.candidates.error) return null;
    const type = defaults.selected.type;
    return { requestId: `default:${defaults.selectionId}`, accountPubkey: account,
      choices: defaults.candidates.entries.map(app => ({ key: `source:${app.key}`, title: app.title, application: applicationListEntry(app) })),
      applicationSelection: { requester: '', content: 'content',
        ...(type.kind === 'action' ? { discovery: { name: type.name, auxiliary: type.auxiliary } } : {}) } };
  }, [account, defaults.selected, defaults.selectionId, defaults.candidates.loaded, defaults.candidates.error, defaults.candidates.entries]);
  const choices = useApplicationChoices(request);
  const canBrowse = defaults.selected?.type.kind === 'action';
  return <AppScreen edges={[]}>
    <FlatList data={defaults.entries} keyExtractor={entry => JSON.stringify(entry.type)} {...scrollProps}
      contentContainerStyle={{ paddingTop: clearance + spacing.sm, paddingBottom: spacing['2xl'], flexGrow: 1 }}
      ListEmptyComponent={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.lg }}>
        {!defaults.loaded ? <DelayedActivityIndicator color={c.textMuted} /> : defaults.error ? <>
          <AppText align="center">{t('applications.request_failed')}</AppText>
          <AppButton label={t('common.retry')} onPress={defaults.retry} />
        </> : <>
          <Widget size={spacing['3xl']} color={c.textMuted} />
          <AppText variant="title" align="center">{t('applications.default_apps_empty')}</AppText>
          <AppText tone="muted" align="center">{t('applications.default_apps_description')}</AppText>
        </>}
      </View>}
      ListHeaderComponent={defaults.entries.length && defaults.error ? <AppButton label={t('common.retry')} onPress={defaults.retry} /> : null}
      renderItem={({ item }) => <DefaultApplicationRow account={account} preference={item} onSelect={defaults.select} />} />
    <ScreenHeader title={t('applications.default_apps')} bordered={scrolled} />
    <BottomSheet<RuntimePromptChoice> visible={!!defaults.selected} title={t('applications.default_app_title')}
      onClose={() => { if (!defaults.saving) defaults.select(null); }}
      fixedSubheader={defaults.selected ? <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <AppText weight="semibold">{defaults.selected.type.name}</AppText>
            {defaults.selected.type.kind === 'action' && defaults.selected.type.auxiliary ?
              <AppText variant="caption" tone="muted">{t('applications.auxiliary_mode')}</AppText> : null}
            <AppText variant="caption" tone="muted">
              {t('applications.default_app_current', { app: defaults.selected.title || t('applications.handler_unavailable') })}
            </AppText>
          </View>
          {defaults.saving ? <DelayedActivityIndicator size="small" color={c.textMuted} /> : null}
        </View>
        <ListRow variant="card" title={t('applications.ask_every_time')} subtitle={t('applications.ask_every_time_notice')}
          subtitleMultiline accessibilityRole="button"
          disabled={defaults.saving} onPress={() => { void defaults.save(null); }} />
        {defaults.saveError ? <AppText tone="danger">{t('applications.request_failed')}</AppText> : null}
      </View> : undefined}
      scrollResetKey={`default:${defaults.selectionId}`}
      listProps={{ data: choices.choices, keyExtractor: choice => choice.key,
        initialNumToRender: 8, onEndReached: choices.more, onEndReachedThreshold: 0.3,
        contentContainerStyle: { paddingBottom: Math.max(bottomInset, spacing.lg) },
        ListFooterComponent: canBrowse && request ? applicationChoiceFooter(choices, t, c.textMuted, { disabled: defaults.saving }) : null,
        ListEmptyComponent: <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {!defaults.candidates.loaded || choices.loading ? <DelayedActivityIndicator color={c.textMuted} /> : defaults.candidates.error ?
            <AppButton label={t('common.retry')} onPress={defaults.retry} /> : !defaults.saving && !choices.error && !choices.hasMore ?
              <AppText tone="muted">{t('applications.no_compatible_apps')}</AppText> : null}
        </View>,
        renderItem: ({ item, index }) => <>
          {canBrowse && (index === 0 || index === choices.savedCount) ?
            <ApplicationChoiceSectionHeader>
              {t(index === 0 ? 'applications.available_apps' : 'applications.other_apps')}
            </ApplicationChoiceSectionHeader> : null}
          <ApplicationListRow application={item.application ?? { title: item.title, kind: 'napp', servers: [] }}
            accessibilityRole="radio" accessibilityState={{ checked: item.application?.key === defaults.selected?.sourceId }}
            trailing={<View style={{ width: spacing.xl, height: spacing.xl, alignItems: 'center', justifyContent: 'center' }}>
              {item.application?.key === defaults.selected?.sourceId ?
                <Check size={spacing.xl} strokeWidth={iconStrokeWidth.default} color={c.accent} /> : null}
            </View>}
            disabled={defaults.saving} onPress={() => {
              if (item.application?.key === defaults.selected?.sourceId) defaults.select(null);
              else if (item.application?.key) void defaults.save({ key: item.application.key }, item.key.startsWith('discovery:'));
            }} />
        </>,
      }} />
  </AppScreen>;
}


function DefaultApplicationRow({ account, preference, onSelect }: {
  account: string; preference: DefaultHandler; onSelect(preference: DefaultHandler): void;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const application = useDefaultHandlerApplication(account, preference);
  return <ListRow variant="list" title={preference.type.name}
    subtitle={preference.type.kind === 'action' && preference.type.auxiliary ? t('applications.auxiliary_mode') : undefined}
    value={preference.title || t('applications.handler_unavailable')}
    valueLeading={<ApplicationIcon release={application} size={spacing.xl} />}
    trailing={<DirectionalChevron size={18} color={c.textMuted} />}
    onPress={() => onSelect(preference)} />;
}
