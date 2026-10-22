import { useEffect, useRef, useState } from 'react';
import { readApplicationWindowPreference, setApplicationWindowPreference } from '@/services/explore/open-preferences';
import type { ExploreEntry } from '@/services/explore/model';

export function useApplicationWindowPreference(entry: Pick<ExploreEntry, 'kind' | 'address'>, account: string) {
  const [value, setValue] = useState<boolean>();
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false), generation = useRef(0);
  const { address, kind } = entry;
  useEffect(() => {
    const current = ++generation.current;
    void readApplicationWindowPreference({ address, kind }, account).then(value => {
      if (generation.current === current) setValue(value);
    }).catch(() => { if (generation.current === current) setError(true); });
    return () => { generation.current = current + 1; };
  }, [address, kind, account]);
  async function change(enabled: boolean) {
    if (busy.current || value === undefined) return;
    const current = generation.current, previous = value;
    busy.current = true; setSaving(true); setError(false); setValue(enabled);
    try { await setApplicationWindowPreference(entry, account, enabled); }
    catch { if (generation.current === current) { setValue(previous); setError(true); } }
    finally { if (generation.current === current) { busy.current = false; setSaving(false); } }
  }
  return { value, error, saving, change };
}
