import { useEffect, useMemo, useState } from 'react';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { discoverApplications, loadMoreApplications } from '@/services/explore/discovery';
import { supportsApplicationAction } from '@/services/explore/action-matching';
import { applicationListEntry } from '@/services/explore/model';
import { useErrorToast } from '@/hooks/use-error-toast';
import { useDiscovery } from '@/stores/explore-discovery.store';

export type ApplicationChoiceRequest = Pick<QueuedPrompt, 'requestId' | 'accountPubkey' | 'choices' | 'applicationSelection'>;

type CatalogueAction = 'discover' | 'retry';
const CHOICE_PAGE_SIZE = 20;
const MAX_EMPTY_QUERY_PAGES = 3;
type Scan = { key: object; queryPages: number; matches: readonly { key: string }[]; keys: Set<string>; emptyPages: number };

/** Keep available handlers first while browsing the verified catalogue in the same picker. */
export function useApplicationChoices(prompt: ApplicationChoiceRequest | null) {
  const state = useDiscovery('napps');
  const filter = prompt?.applicationSelection?.discovery;
  const account = prompt?.accountPubkey;
  const saved = prompt?.choices;
  const [choiceWindow, setChoiceWindow] = useState<{ id: string; account: string; count: number }>();
  const count = choiceWindow && choiceWindow.id === prompt?.requestId && choiceWindow.account === account
    ? choiceWindow.count : CHOICE_PAGE_SIZE;
  const [pendingAction, setPendingAction] = useState<{ id: string; account: string; action: CatalogueAction }>();
  const pending = pendingAction?.id === prompt?.requestId && pendingAction?.account === account ? pendingAction : undefined;
  const [discoveryRequest, setDiscoveryRequest] = useState<{ id: string; account: string }>();
  const enabled = !!filter && !!account && (!saved?.length ||
    discoveryRequest?.id === prompt?.requestId && discoveryRequest?.account === account);
  useEffect(() => {
    if (enabled && account && !saved?.length) void discoverApplications(account, false, 'napps');
  }, [enabled, account, saved?.length]);
  const matches = useMemo(() => {
    if (!enabled || !filter) return [];
    const keys = new Set(saved?.map(choice => choice.application?.key).filter(Boolean));
    return state.entries.filter(app => !keys.has(app.key) && supportsApplicationAction(app, filter));
  }, [saved, filter, enabled, state.entries]);
  // Observe remote query progress together with its merged compatible results;
  // consuming buffered catalogue rows does not spend the empty-page budget.
  const scanKey = useMemo(() => ({ id: prompt?.requestId, account, filter, enabled }), [prompt?.requestId, account, filter, enabled]);
  const [scan, setScan] = useState<Scan>();
  const queryPages = state.queryPages ?? 0;
  const previous = scan?.key === scanKey ? scan : { key: scanKey, queryPages, matches, keys: new Set(matches.map(app => app.key)), emptyPages: 0 };
  const progress = queryPages !== previous.queryPages || matches !== previous.matches;
  const current = progress ? { key: scanKey, queryPages, matches, keys: new Set(matches.map(app => app.key)),
    emptyPages: previous.emptyPages >= MAX_EMPTY_QUERY_PAGES ? previous.emptyPages
      : matches.some(app => !previous.keys.has(app.key)) ? 0
        : previous.emptyPages + Math.max(0, queryPages - previous.queryPages) } : previous;
  if (current !== scan) setScan(current);
  const scanEnded = current.emptyPages >= MAX_EMPTY_QUERY_PAGES;
  const choices = useMemo(() => [...saved ?? [], ...matches.slice(0, count)
    .map(app => ({ key: `discovery:${app.key}`, title: app.title, application: applicationListEntry(app) }))], [saved, matches, count]);
  // Relay pages include incompatible apps and may already be buffered. Keep
  // advancing until this picker has a full matching window or reaches the end.
  const needsPage = enabled && !scanEnded && state.hasMore && matches.length < count && !state.error;
  useEffect(() => {
    if (needsPage && account && state.loaded && !state.loading && !state.loadingMore && !pending)
      void loadMoreApplications(account, 'napps');
  }, [needsPage, account, state.loaded, state.loading, state.loadingMore, state.entries, pending]);
  const run = (action: CatalogueAction, load: () => Promise<void>) => {
    if (!prompt || !account || pending) return;
    const request = { id: prompt.requestId, account, action };
    setPendingAction(request);
    const settled = () => setPendingAction(current => current === request ? undefined : current);
    void load().then(settled, settled);
  };
  const loading = enabled && (!!pending || state.loading || state.loadingMore || needsPage || !state.loaded && !state.error);
  const canDiscover = !!filter && !!account && !enabled;
  useErrorToast(enabled && state.error ? 'applications.request_failed' : undefined);
  return {
    choices,
    savedCount: saved?.length ?? 0,
    canDiscover,
    footerAction: loading ? pending?.action ?? 'discover' : enabled && state.error ? 'retry' : 'discover',
    discover: () => {
      if (!prompt || !account) return;
      setDiscoveryRequest({ id: prompt.requestId, account });
      run('discover', () => discoverApplications(account, false, 'napps'));
    },
    loading,
    manualLoading: !!pending,
    error: enabled && state.error,
    hasMore: enabled && (matches.length > count || !scanEnded && state.hasMore),
    more: () => {
      if (prompt && account && enabled && !loading && !state.error && (matches.length > count || !scanEnded && state.hasMore))
        setChoiceWindow({ id: prompt.requestId, account, count: count + CHOICE_PAGE_SIZE });
    },
    retry: () => { if (account) { setScan(undefined); run('retry', () => discoverApplications(account, true, 'napps')); } },
  };
}
