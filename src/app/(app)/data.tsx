import Download from 'lucide-react-native/icons/download';
import { Archive } from '@solar-icons/react-native/category/notes/Linear/Archive';
import { UploadMinimalistic as Upload } from '@solar-icons/react-native/category/arrows-action/Linear/UploadMinimalistic';
import { FileText } from '@solar-icons/react-native/category/files/Linear/FileText';
import { Paperclip } from '@solar-icons/react-native/category/messages/Linear/Paperclip';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, ScrollView, View } from 'react-native';

import { FileDropZone } from '@/components/common/FileDropZone';
import { AppScreen } from '@/components/common/AppScreen';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ArchiveListItem } from '@/components/backup/archive-list-item';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { formatFileSize } from '@/lib/nostr/file-tags';
import { discardTemporaryComposerFiles } from '@/lib/attachments/composer-file';
import { closeOpenSwipeable } from '@/lib/gestures';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import {
  deleteAccountArchive,
  getLatestAccountArchive,
  revealAccountArchive,
  shareAccountArchive,
  type BackupArchiveInfo,
} from '@/services/dm/dm-backup-storage';
import { useActiveAccount } from '@/stores/active-account.store';
import { useBackupTaskStore } from '@/stores/backup-task.store';
import { showToast } from '@/stores/toast.store';
import { useScrolled } from '@/hooks/use-scrolled';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

/**
 * Data hub — export / import the local chat history. Export carries data *out*
 * of the app (`Upload`, ↑); import brings a backup file *in* (`Download`, ↓).
 */
export default function DataSettings() {
  const { scrolled, scrollProps } = useScrolled();
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const activePubkey = useActiveAccount((s) => s.activePubkey);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const [pendingIncludeAttachments, setPendingIncludeAttachments] = useState<boolean | null>(null);
  const [deletedArchiveName, setDeletedArchiveName] = useState<string | null>(null);
  const sharingArchiveRef = useRef(false);
  const revealingArchiveRef = useRef(false);
  const operation = useBackupTaskStore((s) => s.operation);
  const taskAccountPubkey = useBackupTaskStore((s) => s.accountPubkey);
  const status = useBackupTaskStore((s) => s.status);
  const progress = useBackupTaskStore((s) => s.progress);
  const exportResult = useBackupTaskStore((s) => s.exportResult);
  const importResult = useBackupTaskStore((s) => s.importResult);
  const errorCode = useBackupTaskStore((s) => s.errorCode);
  const startExport = useBackupTaskStore((s) => s.startExport);
  const startImport = useBackupTaskStore((s) => s.startImport);
  const setExportPresentationAvailable = useBackupTaskStore(
    (s) => s.setExportPresentationAvailable,
  );
  const acknowledgeOutcome = useBackupTaskStore((s) => s.acknowledgeOutcome);
  const busy = status === 'running' || status === 'presenting';
  const exporting = busy && operation === 'export';
  const importing = busy && operation === 'import';
  const exportingActiveAccount = exporting && taskAccountPubkey === activePubkey;
  const [storedArchive, setStoredArchive] = useState<BackupArchiveInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activePubkey) return null;
      try {
        return await getLatestAccountArchive(activePubkey);
      } catch (error) {
        console.error('[backup] Failed to load latest archive', error);
        return null;
      }
    };
    void load().then((archive) => {
      if (!cancelled) setStoredArchive(archive);
    });
    return () => {
      cancelled = true;
    };
  }, [activePubkey, deletedArchiveName, exportResult?.archive]);
  const latestArchive = useMemo(() => {
    if (!activePubkey) return null;
    if (
      exportResult?.archive?.accountPubkey === activePubkey &&
      exportResult.archive.name !== deletedArchiveName
    ) {
      return exportResult.archive;
    }
    if (
      storedArchive?.accountPubkey === activePubkey &&
      storedArchive.name !== deletedArchiveName
    ) {
      return storedArchive;
    }
    return null;
  }, [activePubkey, deletedArchiveName, exportResult?.archive, storedArchive]);

  useFocusEffect(
    useCallback(() => {
      const updateAvailability = (state = AppState.currentState) => {
        setExportPresentationAvailable(state === 'active');
      };
      updateAvailability();
      const subscription = AppState.addEventListener('change', updateAvailability);
      return () => {
        subscription.remove();
        setExportPresentationAvailable(false);
      };
    }, [setExportPresentationAvailable]),
  );

  useEffect(() => {
    if (status === 'succeeded' && operation === 'export' && exportResult) {
      acknowledgeOutcome();
      if (exportResult.messages === 0) {
        void platform.confirmationDialog.notify({ title: t('backup.empty'), okLabel: t('common.ok') });
      } else if (exportResult.omittedAttachments > 0) {
        void platform.confirmationDialog.notify({ title: t('backup.export_partial'), okLabel: t('common.ok') });
      }
      return;
    }
    if (status === 'succeeded' && operation === 'import' && importResult) {
      acknowledgeOutcome();
      void platform.confirmationDialog.notify({
        title: t('backup.import_done', {
          inserted: importResult.messages.inserted,
          existing: importResult.messages.existing,
          invalid:
            importResult.messages.invalid +
            importResult.attachments.invalid +
            importResult.proximityPeers.invalid,
          attachments: importResult.attachments.restored,
        }),
        okLabel: t('common.ok'),
      });
      return;
    }
    if (status !== 'failed') return;

    acknowledgeOutcome();
    if (errorCode === 'native_module_unavailable') {
      void platform.confirmationDialog.notify({ title: t('backup.rebuild_required'), okLabel: t('common.ok') });
    } else if (errorCode === 'unsupported_file_type') {
      void platform.confirmationDialog.notify({ title: t('backup.unsupported_file_type'), okLabel: t('common.ok') });
    } else if (errorCode === 'account_mismatch') {
      void platform.confirmationDialog.notify({ title: t('backup.account_mismatch'), okLabel: t('common.ok') });
    } else if (errorCode === 'not_enough_space') {
      void platform.confirmationDialog.notify({ title: t('backup.not_enough_space'), okLabel: t('common.ok') });
    } else if (operation === 'export') {
      void platform.confirmationDialog.notify({ title: t('backup.export_failed'), okLabel: t('common.ok') });
    } else {
      void platform.confirmationDialog.notify({ title: t('backup.import_failed'), okLabel: t('common.ok') });
    }
  }, [
    acknowledgeOutcome,
    errorCode,
    exportResult,
    importResult,
    operation,
    status,
    t,
  ]);

  function runExport(includeAttachments: boolean) {
    if (!activePubkey || busy) return;
    closeOpenSwipeable();
    void startExport(activePubkey, includeAttachments);
  }

  function handleImport() {
    if (!activePubkey || busy) return;
    closeOpenSwipeable();
    void startImport(activePubkey);
  }

  function chooseExport(includeAttachments: boolean) {
    setPendingIncludeAttachments(includeAttachments);
    setExportOptionsOpen(false);
  }

  function startPendingExport() {
    if (pendingIncludeAttachments === null) return;
    const includeAttachments = pendingIncludeAttachments;
    setPendingIncludeAttachments(null);
    runExport(includeAttachments);
  }

  async function handleShareArchive() {
    if (!latestArchive || busy || sharingArchiveRef.current) return;
    sharingArchiveRef.current = true;
    try {
      const shared = await shareAccountArchive(latestArchive);
      if (!shared) {
        void platform.confirmationDialog.notify({ title: t('backup.share_failed'), okLabel: t('common.ok') });
      }
    } catch (error) {
      console.error('[backup] Share failed', error);
      void platform.confirmationDialog.notify({ title: t('backup.share_failed'), okLabel: t('common.ok') });
    } finally {
      sharingArchiveRef.current = false;
    }
  }

  async function handleRevealArchive() {
    if (!latestArchive || busy || revealingArchiveRef.current) return;
    revealingArchiveRef.current = true;
    try {
      if (!(await revealAccountArchive(latestArchive))) {
        void platform.confirmationDialog.notify({
          title: t('backup.reveal_failed'),
          okLabel: t('common.ok'),
        });
      }
    } catch (error) {
      console.error('[backup] Reveal in folder failed', error);
      void platform.confirmationDialog.notify({
        title: t('backup.reveal_failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      revealingArchiveRef.current = false;
    }
  }

  function requestDeleteArchive() {
    if (!latestArchive || busy || sharingArchiveRef.current) return;
    const archive = latestArchive;
    void platform.confirmationDialog
      .confirm({
        title: t('backup.delete_archive'),
        message: t('backup.delete_archive_confirm'),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('common.delete'),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) void confirmDeleteArchive(archive);
      });
  }

  async function confirmDeleteArchive(archive: BackupArchiveInfo) {
    try {
      await deleteAccountArchive(archive);
      setDeletedArchiveName(archive.name);
      showToast(t('backup.archive_deleted'));
    } catch (error) {
      console.error('[backup] Delete failed', error);
      void platform.confirmationDialog.notify({ title: t('backup.delete_failed'), okLabel: t('common.ok') });
    }
  }

  return (
    <AppScreen edges={[]}>
      <FileDropZone
        enabled={!!activePubkey && !busy && !exportOptionsOpen}
        title={t('backup.drop_title')}
        hint={t('backup.drop_hint')}
        icon={<Download strokeWidth={iconStrokeWidth.default} size={24} color={c.accent} />}
        onDropFiles={(files) => {
          if (!activePubkey || busy) return;
          if (files.length !== 1) {
            discardTemporaryComposerFiles(files);
            showToast(t('backup.drop_single'));
            return;
          }
          closeOpenSwipeable();
          void startImport(
            activePubkey,
            files[0].file
              ? { file: files[0].file, name: files[0].name }
              : {
                  uri: files[0].uri,
                  name: files[0].name,
                  temporary: files[0].temporary,
                },
          );
        }}
      >
        <ScrollView
          {...scrollProps}
          onScrollBeginDrag={() => closeOpenSwipeable()}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: titleClearance + spacing.sm,
            paddingBottom: spacing['2xl'],
            gap: spacing.xl,
          }}
        >
          <ListGroup>
            <ListRow
              icon={<Upload size={22} color={c.text} />}
              title={t('backup.export')}
              onPress={() => setExportOptionsOpen(true)}
              disabled={busy}
            />
            <ListRow
              icon={<Download strokeWidth={iconStrokeWidth.default} size={22} color={c.text} />}
              title={t('backup.import')}
              value={importing && progress ? `${progress.percent}%` : undefined}
              onPress={handleImport}
              loading={importing}
              disabled={busy}
            />
          </ListGroup>

          {exportingActiveAccount || latestArchive ? (
            <View style={{ gap: spacing.sm }}>
              <SectionLabel>{t('backup.latest_archive')}</SectionLabel>
              {exportingActiveAccount ? (
                <ListRow
                  icon={<Archive size={22} color={c.text} />}
                  title={t('backup.creating_archive')}
                  subtitle={t('backup.creating_archive_hint')}
                  value={`${progress?.percent ?? 0}%`}
                  loading
                  disabled
                />
              ) : latestArchive ? (
                <ArchiveListItem
                  key={latestArchive.name}
                  title={t('backup.archive_title')}
                  subtitle={t('backup.archive_created', {
                    date: new Date(latestArchive.createdAt).toLocaleString(i18n.language),
                  })}
                  value={formatFileSize(latestArchive.size) ?? undefined}
                  onPress={() => void handleShareArchive()}
                  onReveal={IS_ELECTRON ? () => void handleRevealArchive() : undefined}
                  onDelete={requestDeleteArchive}
                  disabled={busy}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </FileDropZone>
      <ScreenHeader bordered={scrolled} title={t('backup.section')} />

      <BottomSheet
        visible={exportOptionsOpen}
        onClose={() => setExportOptionsOpen(false)}
        onClosed={startPendingExport}
        title={t('backup.export_title')}
      >
        <View style={{ gap: spacing.xs }}>
          <ListRow
            variant="plain"
            icon={<FileText size={22} color={c.text} />}
            title={t('backup.messages_only')}
            onPress={() => chooseExport(false)}
          />
          <ListRow
            variant="plain"
            icon={<Paperclip size={22} color={c.text} />}
            title={t('backup.messages_and_attachments')}
            onPress={() => chooseExport(true)}
          />
        </View>
      </BottomSheet>

    </AppScreen>
  );
}
