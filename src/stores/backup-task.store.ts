import { create } from 'zustand';

import i18n from '@/i18n';
import {
  BackupError,
  exportAccountArchive,
  importAccountArchive,
  type BackupErrorCode,
  type BackupExportResult,
  type BackupImportResult,
  type BackupProgress,
} from '@/services/dm/dm-backup.service';
import { shareAccountArchive } from '@/services/dm/dm-backup-storage';
import { showToast } from '@/stores/toast.store';

type BackupOperation = 'export' | 'import';
type BackupTaskStatus = 'idle' | 'running' | 'presenting' | 'succeeded' | 'failed';
type BackupImportSource =
  | Blob
  | { file: Blob; name?: string }
  | { uri: string; name?: string; temporary?: boolean };

type State = {
  operation: BackupOperation | null;
  accountPubkey: string | null;
  status: BackupTaskStatus;
  progress: BackupProgress | null;
  exportResult: BackupExportResult | null;
  importResult: BackupImportResult | null;
  errorCode: BackupErrorCode | 'unknown' | null;
  exportPresentationAvailable: boolean;
  startExport: (accountPubkey: string, includeAttachments: boolean) => Promise<void>;
  startImport: (accountPubkey: string, source?: BackupImportSource) => Promise<void>;
  setExportPresentationAvailable: (available: boolean) => void;
  acknowledgeOutcome: () => void;
};

const idleState = {
  operation: null,
  accountPubkey: null,
  status: 'idle' as const,
  progress: null,
  exportResult: null,
  importResult: null,
  errorCode: null,
};

function errorCode(error: unknown): BackupErrorCode | 'unknown' {
  return error instanceof BackupError ? error.code : 'unknown';
}

function isActive(status: BackupTaskStatus): boolean {
  return status === 'running' || status === 'presenting';
}

export const useBackupTaskStore = create<State>((set, get) => ({
  ...idleState,
  exportPresentationAvailable: false,

  startExport: async (accountPubkey, includeAttachments) => {
    if (isActive(get().status)) return;
    set({
      operation: 'export',
      accountPubkey,
      status: 'running',
      progress: null,
      exportResult: null,
      importResult: null,
      errorCode: null,
    });
    try {
      const result = await exportAccountArchive(accountPubkey, {
        includeAttachments,
        onProgress: (progress) => set({ progress }),
      });
      const presentShare = Boolean(result.archive && get().exportPresentationAvailable);
      set({
        status: presentShare ? 'presenting' : 'succeeded',
        exportResult: result,
        progress: null,
      });
      if (result.archive) {
        if (presentShare) {
          try {
            const shared = await shareAccountArchive(result.archive);
            if (!shared) showToast(i18n.t('backup.share_failed'));
          } catch (error) {
            console.error('[backup] Share failed', error);
            showToast(i18n.t('backup.share_failed'));
          }
        } else {
          showToast(i18n.t('backup.archive_ready'));
        }
      }
      if (presentShare) set({ status: 'succeeded' });
    } catch (error) {
      console.error('[backup] Export failed', error);
      set({ status: 'failed', errorCode: errorCode(error), progress: null });
    }
  },

  startImport: async (accountPubkey, source) => {
    if (isActive(get().status)) return;
    set({
      operation: 'import',
      accountPubkey,
      status: 'running',
      progress: null,
      exportResult: null,
      importResult: null,
      errorCode: null,
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const importSource =
        source && typeof source === 'object' && ('file' in source || 'uri' in source)
          ? source
          : source
            ? { file: source }
            : undefined;
      const result = await importAccountArchive(accountPubkey, {
        file: undefined,
        ...importSource,
        onProgress: (progress) => set({ progress }),
      });
      if (result) set({ status: 'succeeded', importResult: result, progress: null });
      else set(idleState);
    } catch (error) {
      console.error('[backup] Import failed', error);
      set({ status: 'failed', errorCode: errorCode(error), progress: null });
    }
  },

  setExportPresentationAvailable: (available) => {
    set({ exportPresentationAvailable: available });
  },

  acknowledgeOutcome: () => {
    if (!isActive(get().status)) set(idleState);
  },
}));
