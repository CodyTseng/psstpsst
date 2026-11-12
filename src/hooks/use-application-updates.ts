import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNewerEvent } from '@/lib/nostr/event-version';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { showToast } from '@/stores/toast.store';
import type { ExploreEntry } from '@/services/explore/model';

export type ApplicationUpdateTarget = { entry: ExploreEntry; account: string; blocked?: boolean; restart(entry: ExploreEntry): void | Promise<void> };

/** Check once after opening; keep running content pinned until the user accepts. */
export function useApplicationUpdates(target: ApplicationUpdateTarget | undefined, active: boolean) {
  const { t } = useTranslation();
  const [latest, setLatest] = useState<ExploreEntry>();
  const [decision, setDecision] = useState(0);
  const [focused, setFocused] = useState(!IS_ELECTRON);
  const [foreground, setForeground] = useState(() => platform.appState?.currentState?.() !== 'background');
  const mounted = useRef(true), prompting = useRef(false), prompted = useRef(new Set<string>());
  const check = useRef<{ life: AbortController; started: boolean } | undefined>(undefined);
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
    const request = { life: new AbortController(), started: false };
    check.current = request;
    return () => { request.life.abort(); };
  }, [account, source, version]);
  useEffect(() => {
    const request = check.current;
    if (!replaceable || !account || !active || !request || request.started) return;
    const current = runningEntry();
    if (!current) return;
    // Let the application render before loading update services or doing network work.
    const timer = setTimeout(() => {
      request.started = true;
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Defer database-backed services until the app has opened.
      const { resolveApplicationMetadata } = require('@/services/explore/application-metadata') as typeof import('@/services/explore/application-metadata');
      void resolveApplicationMetadata(account, current, request.life.signal, { refresh: true, known: [current] })
        .then(updated => { if (!request.life.signal.aborted) setLatest(updated); })
        .catch(() => {});
    }, 0);
    return () => { clearTimeout(timer); };
  }, [account, source, version, replaceable, active]);
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
