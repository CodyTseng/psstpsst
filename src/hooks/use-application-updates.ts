import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNewerEvent } from '@/lib/nostr/event-version';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { showToast } from '@/stores/toast.store';
import type { ExploreEntry } from '@/services/explore/model';

export type ApplicationUpdateTarget = { entry: ExploreEntry; account: string; blocked?: boolean; restart(entry: ExploreEntry): void | Promise<void> };

/** Running content stays pinned until a foreground user accepts one newer release. */
export function useApplicationUpdates(target: ApplicationUpdateTarget | undefined, active: boolean) {
  const { t } = useTranslation();
  const [latest, setLatest] = useState<ExploreEntry>();
  const [decision, setDecision] = useState(0);
  const [focused, setFocused] = useState(!IS_ELECTRON);
  const [foreground, setForeground] = useState(() => platform.appState?.currentState?.() !== 'background');
  const mounted = useRef(true), prompting = useRef(false), prompted = useRef(new Set<string>());
  const entry = target?.entry, account = target?.account;
  const source = entry?.key, version = entry?.manifest?.id;
  const replaceable = !!entry?.manifest && entry.manifest.kind !== 5129 && entry.kind !== 'website';
  const presentable = active && focused && foreground;
  const runningEntry = useEffectEvent(() => target?.entry);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => platform.appState?.addChangeListener?.(state => setForeground(state === 'active')), []);
  useEffect(() => {
    if (!IS_ELECTRON) return;
    let current = true, revision = 0;
    const stop = platform.windowChrome?.addFocusListener?.(value => { revision++; if (current) setFocused(value); });
    void (platform.windowChrome?.getFocusState?.() ?? Promise.resolve(true)).then(value => {
      if (current && revision === 0) setFocused(value);
    }).catch(() => {});
    return () => { current = false; stop?.(); };
  }, []);
  useEffect(() => {
    if (!replaceable || !account) return;
    const current = runningEntry();
    if (!current) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Defer database-backed services until a signed app mounts.
    const { watchApplicationMetadata } = require('@/services/explore/application-metadata') as typeof import('@/services/explore/application-metadata');
    const subscription = watchApplicationMetadata(account, current, updated => {
      if (updated.key === current.key) setLatest(previous => previous?.manifest?.id === updated.manifest?.id ? previous : updated);
    });
    if (presentable) subscription.refresh();
    const timer = setInterval(() => {
      if (presentable && platform.appState.currentState() === 'active') subscription.refresh();
    }, 60_000);
    return () => { clearInterval(timer); subscription.stop(); };
  }, [account, source, version, replaceable, presentable]);
  const settle = useEffectEvent(async (owner: string | undefined, key: string | undefined, old: string | undefined, accepted: boolean) => {
    if (!target || target.account !== owner || target.entry.key !== key || target.entry.manifest?.id !== old || !latest?.manifest) return;
    prompted.current.add(JSON.stringify([owner, key, old, latest.manifest.id]));
    if (!accepted || !active || target.blocked || platform.appState.currentState() !== 'active' || !isNewerEvent(latest.manifest, target.entry.manifest!)) return;
    if (IS_ELECTRON && platform.windowChrome?.getFocusState && !await platform.windowChrome.getFocusState()) return;
    await target.restart(latest);
  });
  useEffect(() => {
    const current = runningEntry();
    if (!presentable || target?.blocked || prompting.current || !latest?.manifest || !current?.manifest ||
        latest.key !== source || !isNewerEvent(latest.manifest, current.manifest)) return;
    const id = JSON.stringify([account, source, version, latest.manifest.id]);
    if (prompted.current.has(id)) return;
    prompted.current.add(id); prompting.current = true;
    void platform.confirmationDialog.confirm({ title: t('applications.update_available'),
      message: t('applications.update_notice', { name: latest.title }), cancelLabel: t('applications.update_later'), confirmLabel: t('applications.update_restart'),
    }).then(async accepted => { if (mounted.current) await settle(account, source, version, accepted); })
      .catch(() => { if (mounted.current) showToast(t('applications.request_failed'), { variant: 'error' }); })
      .finally(() => { prompting.current = false; if (mounted.current) setDecision(value => value + 1); });
  }, [account, source, version, presentable, target?.blocked, latest, decision, t]);
}
