import { useCallback, useEffect, useState } from 'react';

import {
  loadLicenseCatalog, loadProjectNotices,
  type LicenseCatalog, type LicensedProject, type NoticeChunk,
} from '@/services/licenses/licenses.service';

export function useLicenseCatalog() {
  const [catalog, setCatalog] = useState<LicenseCatalog | null>(null);
  const [errorAttempt, setErrorAttempt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    void loadLicenseCatalog().then(
      (value) => { if (active) setCatalog(value); },
      () => { if (active) setErrorAttempt(attempt); },
    );
    return () => { active = false; };
  }, [attempt]);
  return { catalog, error: errorAttempt === attempt, retry };
}

export function useProjectNotices(project: LicensedProject | undefined) {
  const [state, setState] = useState<{
    project: LicensedProject; attempt: number; chunks?: readonly NoticeChunk[]; error?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    if (project) {
      void loadProjectNotices(project).then(
        (chunks) => { if (active) setState({ project, attempt, chunks }); },
        () => { if (active) setState({ project, attempt, error: true }); },
      );
    }
    return () => { active = false; };
  }, [project, attempt]);
  return { chunks: state?.project === project && state?.attempt === attempt ? state?.chunks : undefined,
    error: state?.project === project && state?.attempt === attempt && state?.error, retry };
}
