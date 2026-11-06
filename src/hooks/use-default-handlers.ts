import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { findCatalogueHandler, readDefaultHandlerCandidates, readDefaultHandlers, readHandlerCandidates, setDefaultHandler, type DefaultHandler } from '@/services/explore/default-handlers';
import type { ExploreEntry } from '@/services/explore/model';

/** Reads only the bounded preference namespace, never application history. */
export function useDefaultHandlers(account: string) {
  const focused = useIsFocused();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ entries: DefaultHandler[]; loaded: boolean; error: boolean }>({ entries: [], loaded: false, error: false });
  const [selectionId, setSelectionId] = useState(0);
  const [selected, setSelected] = useState<DefaultHandler | null>(null);
  const [candidates, setCandidates] = useState<{ entries: ExploreEntry[]; loaded: boolean; error: boolean }>({ entries: [], loaded: false, error: false });
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    void readDefaultHandlers(account).then(entries => {
      if (!cancelled) setState({ entries, loaded: true, error: false });
    }, () => { if (!cancelled) setState(current => ({ ...current, loaded: true, error: true })); });
    return () => { cancelled = true; };
  }, [account, focused, revision]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const controller = new AbortController();
    void readDefaultHandlerCandidates(account, selected, controller.signal).then(entries => {
      if (!cancelled) setCandidates({ entries, loaded: true, error: false });
    }, () => { if (!cancelled) setCandidates({ entries: [], loaded: true, error: true }); });
    return () => { cancelled = true; controller.abort(); };
  }, [account, selected, revision]);
  const save = useCallback(async (app: Pick<ExploreEntry, 'key'> | null, catalogue = false) => {
    if (!selected || busy.current) return;
    busy.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      const current = app && (catalogue ? findCatalogueHandler(selected.type, app.key)
        : (await readHandlerCandidates(account, selected.type)).find(candidate => candidate.key === app.key));
      if (app && !current) throw new Error('handler-unavailable');
      await setDefaultHandler(account, selected.type, current || null);
      setState(currentState => ({ ...currentState, entries: app && current ? currentState.entries.map(entry => JSON.stringify(entry.type) === JSON.stringify(selected.type)
        ? { ...entry, sourceId: selected.type.kind === 'intent' ? current.release!.eventKey : current.key, title: current.title, address: current.address } : entry)
        : currentState.entries.filter(entry => JSON.stringify(entry.type) !== JSON.stringify(selected.type)) }));
      setSelected(null);
    } catch { setSaveError(true); }
    finally { busy.current = false; setSaving(false); }
  }, [account, selected]);
  return { ...state, selected, selectionId, select: (entry: DefaultHandler | null) => {
    if (busy.current) return;
    setCandidates({ entries: [], loaded: false, error: false });
    setSaveError(false);
    if (entry) setSelectionId(value => value + 1);
    setSelected(entry);
  }, candidates, saving, saveError, save,
    retry: () => {
      setCandidates({ entries: [], loaded: false, error: false });
      setRevision(value => value + 1);
    } };
}
