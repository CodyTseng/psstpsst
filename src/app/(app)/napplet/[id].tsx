import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { naddrEncode } from 'nostr-tools/nip19';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { NappletSummary } from '@/components/napplet/NappletSummary';
import { useNappletRelease } from '@/hooks/use-napplet-release';
import { NAP_DOMAINS } from '@/services/napplet/protocol';
import { nappletService } from '@/services/napplet/service';
import { platform } from '@/platform';
import { spacing, useThemeColors } from '@/theme';

export default function NappletDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { release, installed, accountPubkey, error: loadError, setRelease } = useNappletRelease(id);
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    void work().catch((error: Error) => {
      if (!['permission-denied', 'session-closed'].includes(error.message))
        setError(error.message.startsWith('napplets.') ? error.message : 'napplets.request_failed');
    }).finally(() => setBusy(false));
  }
  async function confirm(action: 'update' | 'rollback' | 'migrate', work: () => Promise<void>) {
    if (await platform.confirmationDialog.confirm({ title: t(`napplets.${action}`), message: t(`napplets.${action}_notice`),
      confirmLabel: t(`napplets.${action}`), cancelLabel: t('common.cancel') })) await work();
  }
  const unsupported = release?.required.some((domain) => !(NAP_DOMAINS as readonly string[]).includes(domain));
  const message = error ?? loadError;
  return <AppScreen edges={[]}>
    <ScreenHeader title={release?.title ?? t('napplets.app_title')} />
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: clearance + spacing.lg, gap: spacing.xl }}>
      {message ? <AppText tone="danger">{t(message)}</AppText> : null}
      {!release ? (!message ? <ActivityIndicator color={c.accent} /> : null) : <>
        <NappletSummary release={release} onPublisher={() => router.push(`/profile/${release.event.pubkey}`)} />
        {unsupported ? <AppText tone="danger">{t('napplets.unsupported')}</AppText> : null}
        <View style={{ gap: spacing.sm }}>
          <AppButton label={t(installed ? 'napplets.open' : 'napplets.install')} disabled={unsupported || busy}
            onPress={() => {
              try {
                const runId = nappletService.prepareOpen(installed ?? release, accountPubkey ?? '');
                router.push({ pathname: '/napplet-run', params: { runId } });
              } catch { setError('napplets.request_failed'); }
            }} />
          {installed && installed.hash !== release.hash ? <AppButton variant="secondary" loading={busy}
            label={t('napplets.update')} onPress={() => run(() => confirm('update', () => nappletService.install(release, accountPubkey ?? '')))} /> : null}
        </View>
        <ListGroup>
          <ListRow title={t('napplets.permissions_manage')}
            trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted} />}
            onPress={() => router.push({ pathname: '/napplet-permissions/[id]', params: { id: installed?.event.id ?? release.event.id } })} />
          {installed && release.event.kind !== 5129 ? <ListRow title={t('napplets.check_update')} loading={busy} disabled={busy}
            onPress={() => run(async () => {
              const next = await nappletService.resolve(naddrEncode({ kind: release.event.kind, pubkey: release.event.pubkey,
                identifier: release.event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '' }), { refresh: true });
              setRelease(next);
              if (next.hash === installed.hash) setNotice('napplets.up_to_date');
            })} /> : null}
        </ListGroup>
        {notice ? <AppText variant="caption" tone="muted">{t(notice)}</AppText> : null}
        {installed?.previousManifest ? <ListGroup>
          <ListRow title={t('napplets.rollback')} disabled={busy} loading={busy}
            onPress={() => run(() => confirm('rollback', () => nappletService.rollback(installed, accountPubkey ?? '')))} />
          <ListRow title={t('napplets.migrate')} disabled={busy}
            onPress={() => run(() => confirm('migrate', () => nappletService.migrate(installed, accountPubkey ?? '')))} />
        </ListGroup> : null}
      </>}
    </ScrollView>
  </AppScreen>;
}
