import { useEffect, useRef, useState } from 'react';

import { platform } from '@/platform';
import { showToast } from '@/stores/toast.store';

const WATCHED_TABLES = {
  dm: ['routing_settings_edits', 'relay_lists'],
  write: ['routing_settings_edits', 'replaceable_events'],
  blossom: ['routing_settings_edits', 'media_server_lists'],
  discovery: ['device_preferences'],
};

type SettingsList = keyof typeof WATCHED_TABLES;
type ListState = { saved: string[]; draft?: string[]; saveFailed?: boolean };

export function useSettingsAutosave(
  kind: SettingsList,
  load: (() => Promise<string[]>) | null,
  save: (urls: string[]) => Promise<void>,
  failureMessage: string,
) {
  const [list, setList] = useState<ListState>();
  const [loadError, setLoadError] = useState<Error>();
  const revision = useRef(0);
  const saving = useRef(false);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    if (!load) return;
    let active = true;
    let reading = false;
    let refreshRequested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function scheduleRefresh() {
      refreshRequested = true;
      if (!active || saving.current || reading || timer !== undefined) return;
      // A single edit can change the pending list and its read model in one transaction.
      timer = setTimeout(() => {
        timer = undefined;
        read();
      }, 0);
    }

    function read() {
      if (!active || saving.current || reading || !load) return;
      reading = true;
      refreshRequested = false;
      const startedAt = revision.current;
      void load().then((urls) => {
        if (!active || startedAt !== revision.current) return;
        setList(current => {
          const sameList = current && current.saved.length === urls.length &&
            current.saved.every((url, index) => url === urls[index]);
          // A failed local draft remains retryable while its base is still current.
          return sameList ? current : { saved: urls };
        });
        setLoadError(undefined);
      }, (error: unknown) => {
        if (active && startedAt === revision.current) {
          setLoadError(error instanceof Error ? error : new Error(String(error)));
        }
      }).finally(() => {
        reading = false;
        if (refreshRequested) scheduleRefresh();
      });
    }

    refresh.current = scheduleRefresh;
    const unsubscribe = platform.database.addChangeListener(({ tableName }) => {
      if (!tableName || WATCHED_TABLES[kind].includes(tableName)) scheduleRefresh();
    });
    read();

    return () => {
      active = false;
      saving.current = false;
      refresh.current = () => {};
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
  }, [kind, load]);

  async function persist(urls: string[]) {
    const current = ++revision.current;
    const editorRefresh = refresh.current;
    saving.current = true;
    setList(value => value && { saved: value.saved, draft: urls });
    try {
      await save(urls);
      if (revision.current !== current || refresh.current !== editorRefresh) return;
      setList({ saved: urls });
    } catch {
      if (revision.current !== current || refresh.current !== editorRefresh) return;
      setList(value => value && { saved: value.saved, draft: urls, saveFailed: true });
      showToast(failureMessage, { variant: 'error', target: 'detail' });
    } finally {
      if (revision.current === current && refresh.current === editorRefresh) {
        saving.current = false;
        editorRefresh();
      }
    }
  }

  return {
    urls: list?.draft ?? list?.saved,
    saveFailed: list?.saveFailed,
    loadError,
    persist,
    retryLoad: () => refresh.current(),
  };
}
