import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { Avatar } from '@/components/common/Avatar';
import { IdentityListItem } from '@/components/common/IdentityListItem';
import { useDisplayName } from '@/hooks/use-display-name';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { NappletIcon } from '@/components/napplet/NappletIcon';
import { NappletPermissions } from '@/components/napplet/NappletPermissions';
import { NAP_DOMAINS, parseManifest, type NappletRelease } from '@/services/napplet/protocol';
import { nappletService } from '@/services/napplet/service';
import { platform } from '@/platform';
import { useNapplets } from '@/stores/napplet.store';
import { spacing, useThemeColors } from '@/theme';

function Publisher({ pubkey }: { pubkey: string }) {
  const { name, profile } = useDisplayName(pubkey);
  return (
    <View style={{ marginHorizontal: -spacing.lg }}>
      <IdentityListItem
        leading={<Avatar pubkey={pubkey} picture={profile?.picture} />}
        title={name}
        onPress={() => router.push(`/profile/${pubkey}`)}
      />
    </View>
  );
}

export default function NappletDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useNapplets();
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const [resolved, setResolved] = useState<NappletRelease>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const release =
    resolved ??
    state.market.find((app) => app.event.id === id) ??
    state.installed.find((app) => app.event.id === id);
  const installed = release ? state.installed.find((app) => app.key === release.key) : undefined;
  useEffect(() => {
    if (!release && id && state.loaded)
      void nappletService
        .resolve(id)
        .then(setResolved)
        .catch((error: Error) => setError(error.message.startsWith('napplets.') ? error.message : 'napplets.request_failed'));
  }, [id, release, state.loaded]);
  function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    void work()
      .catch((e: Error) => {
        if (!['permission-denied', 'session-closed'].includes(e.message)) setError(e.message);
      })
      .finally(() => setBusy(false));
  }
  const unsupported = release?.required.filter(
    (domain) => !(NAP_DOMAINS as readonly string[]).includes(domain),
  );
  return (
    <AppScreen edges={[]}>
      <ScreenHeader title={release?.title ?? t('napplets.app_title')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: clearance + spacing.lg,
          gap: spacing.lg,
        }}
      >
        {error ? (
          <AppText style={{ color: c.danger }}>
            {t(error.startsWith('napplets.') ? error : 'napplets.request_failed')}
          </AppText>
        ) : null}
        {!release ? (
          error ? null : (
            <ActivityIndicator color={c.accent} />
          )
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
              <NappletIcon release={release} />
              <AppText variant="title" style={{ flex: 1 }}>
                {release.title}
              </AppText>
            </View>
            <AppText>{release.description}</AppText>
            <AppText variant="caption" tone="muted">
              {t('napplets.publisher')}
            </AppText>
            <Publisher pubkey={release.event.pubkey} />
            <AppText variant="caption" tone="muted">
              {t('napplets.permissions')}
            </AppText>
            <AppText>
              {[...release.required, ...release.optional]
                .map((domain) => t(`napplets.capability_${domain}`, { defaultValue: domain }))
                .join(', ') || t('napplets.none')}
            </AppText>
            {unsupported?.length ? (
              <AppText style={{ color: c.danger }}>
                {t('napplets.unsupported')}: {unsupported.map((domain) => t(`napplets.capability_${domain}`, { defaultValue: domain })).join(', ')}
              </AppText>
            ) : null}
            <AppButton
              loading={busy}
              disabled={!!unsupported?.length}
              label={t(installed ? 'napplets.open' : 'napplets.install')}
              onPress={() => {
                try {
                  const runId = nappletService.prepareOpen(installed ?? release, state.accountPubkey ?? '');
                  router.push({ pathname: '/napplet-run', params: { runId } });
                } catch {
                  setError('napplets.request_failed');
                }
              }}
            />
            {installed && installed.hash !== release.hash ? (
              <AppButton
                variant="secondary"
                loading={busy}
                label={t('napplets.update')}
                onPress={() =>
                  run(async () => {
                    if (
                      !(await platform.confirmationDialog.confirm({
                        title: t('napplets.update'),
                        message: t('napplets.update_notice'),
                        confirmLabel: t('napplets.update'),
                        cancelLabel: t('common.cancel'),
                      }))
                    )
                      return;
                    await nappletService.install(release, state.accountPubkey ?? '');
                  })
                }
              />
            ) : null}
            {installed?.previousManifest ? (
              <AppButton
                variant="ghost"
                label={t('napplets.rollback')}
                onPress={() =>
                  run(async () => {
                    if (
                      await platform.confirmationDialog.confirm({
                        title: t('napplets.rollback'),
                        message: t('napplets.rollback_notice'),
                        confirmLabel: t('napplets.rollback'),
                        cancelLabel: t('common.cancel'),
                      })
                    )
                      await nappletService.rollback(installed, state.accountPubkey ?? '');
                  })
                }
              />
            ) : null}
            {installed ? (
              <>
                <NappletPermissions key={`${state.accountPubkey}:${installed.key}:${installed.hash}`} release={installed} />
                <AppButton
                  variant="ghost"
                  label={t('napplets.revoke')}
                  onPress={() =>
                    run(async () => {
                      if (
                        await platform.confirmationDialog.confirm({
                          title: t('napplets.revoke'),
                          message: t('napplets.revoke_notice'),
                          confirmLabel: t('napplets.revoke'),
                          cancelLabel: t('common.cancel'),
                        })
                      )
                        await nappletService.revoke(installed, state.accountPubkey ?? '');
                    })
                  }
                />
                <AppButton
                  variant="ghost"
                  label={t('napplets.clear_defaults')}
                  onPress={() =>
                    run(() =>
                      nappletService.clearDefaults(installed.key, state.accountPubkey ?? ''),
                    )
                  }
                />
              </>
            ) : null}
            {installed?.previousManifest ? (
              <AppButton
                variant="ghost"
                label={t('napplets.migrate')}
                onPress={() =>
                  run(async () => {
                    if (
                      await platform.confirmationDialog.confirm({
                        title: t('napplets.migrate'),
                        message: t('napplets.migrate_notice'),
                        confirmLabel: t('napplets.migrate'),
                        cancelLabel: t('common.cancel'),
                      })
                    )
                      await nappletService.migrate(installed, state.accountPubkey ?? '');
                  })
                }
              />
            ) : null}
            <AppText variant="caption" tone="muted">
              {t('napplets.version')}
            </AppText>
            <AppText variant="code" selectable>
              {release.hash}
            </AppText>
            {installed ? (
              <AppButton
                variant="ghost"
                label={t('napplets.check_update')}
                loading={busy}
                onPress={() =>
                  run(async () => {
                    if (release.event.kind === 5129) {
                      setError('napplets.immutable_version');
                      return;
                    }
                    const { naddrEncode } = await import('nostr-tools/nip19');
                    const next = await nappletService.resolve(
                      naddrEncode({
                        kind: release.event.kind,
                        pubkey: release.event.pubkey,
                        identifier: release.event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '',
                      }),
                      { refresh: true },
                    );
                    setResolved(parseManifest(next.event));
                    if (next.hash === installed.hash) setError('napplets.up_to_date');
                  })
                }
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}
