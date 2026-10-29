import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NappletRequiredAccess } from './NappletRequiredAccess';
import { ApprovalDetails, ApprovalField, ApprovalText } from './ApprovalDetails';
import { ActionRow } from '@/components/common/ActionRow';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import { nappletService } from '@/services/napplet/service';
import { PermissionActions, SigningDurationMenu } from './SigningApproval';
import type { ContextMenuAnchor } from '@/components/common/ContextMenu';
import { rememberBrowserPermission, browserPermissionLabel } from '@/services/explore/browser-permissions';
import { spacing } from '@/theme';

export function CapabilityActions({ prompt, duration = 'allow', menuOpen = false, onMenuChange = () => {} }: {
  prompt: QueuedPrompt; duration?: string; menuOpen?: boolean; onMenuChange?: (anchor: ContextMenuAnchor | null) => void;
}) {
  const { t } = useTranslation();
  if (prompt.capabilities?.requested) return <ActionRow layout="horizontal"
    confirm={{ label: t('applications.allow'), onPress: () => nappletService.answer(prompt.requestId, 'allow') }}
    dismiss={{ label: t('applications.signing_reject'), onPress: () => nappletService.answer(prompt.requestId, 'deny') }} />;
  if (prompt.browser?.action === 'permission' && rememberBrowserPermission(prompt.browser.resources ?? []))
    return <PermissionActions prompt={prompt} duration={duration} menuOpen={menuOpen} onMenuChange={onMenuChange}
      remember label={t('applications.signing_remember')} />;
  return <ActionRow layout="horizontal"
    confirm={{ label: t('applications.allow'), onPress: () => nappletService.answer(prompt.requestId, prompt.capabilities ? 'domains:[]' : 'allow') }}
    dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} />;
}

/** Approval content describes this request, independently of application marketing metadata. */
export function CapabilityApproval({ prompt, hideActions = false }: { prompt: QueuedPrompt; hideActions?: boolean }) {
  const { t } = useTranslation();
  const [duration, setDuration] = useState('allow');
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const browser = prompt.browser;
  const required = prompt.capabilities?.required ?? prompt.application?.required ?? prompt.app?.required ?? [];
  return <View style={{ gap: spacing.lg }}>
    {prompt.installation ? <>
      <ApprovalText>{t(prompt.installation.replacing ? 'applications.local_replace_notice' : 'applications.local_install_notice')}</ApprovalText>
      <ApprovalDetails>
        <ApprovalText>{prompt.installation.target.title}</ApprovalText>
        <ApprovalText variant="code">{prompt.installation.id}</ApprovalText>
        <ApprovalText tone="muted">{t('applications.local_unsigned_notice')}</ApprovalText>
        {prompt.installation.otherInstaller ? <ApprovalText tone="danger">{t('applications.local_other_installer_notice')}</ApprovalText> : null}
      </ApprovalDetails>
      <NappletRequiredAccess release={{ required: prompt.installation.target.required }} />
    </> : browser ? <ApprovalDetails>
      {browser.action === 'permission' ? <>
        {browser.resources?.length ? [...new Set(browser.resources)].map(resource =>
          <ApprovalText key={resource} variant="body">{browserPermissionLabel(resource, t)}</ApprovalText>)
          : <ApprovalText variant="body">{prompt.detail || t('applications.browser_permission')}</ApprovalText>}
      </> : null}
      {browser.filename ? <ApprovalField label={t('attach.file')}>
        <ApprovalText>{browser.filename}</ApprovalText>
      </ApprovalField> : null}
      {browser.url ? <ApprovalField label={t('applications.signing_destinations')}>
        <ApprovalText>{browser.url}</ApprovalText>
      </ApprovalField> : null}
    </ApprovalDetails> : prompt.device ? <>
      <ApprovalDetails>
        {prompt.device.operation === 'save-file' ? <ApprovalField label={t('attach.file')}>
          <ApprovalText>{prompt.detail}</ApprovalText>
        </ApprovalField> : <ApprovalText>{prompt.detail}</ApprovalText>}
      </ApprovalDetails>
      <ApprovalText tone="muted">{t(prompt.device.operation === 'save-file' ? 'applications.save_file_notice' : 'applications.copy_text_notice')}</ApprovalText>
    </> : prompt.crypto ? <>
      <ApprovalDetails>
        <ApprovalText>{prompt.crypto.algorithm === 'nip04' ? 'NIP-04' : 'NIP-44'}</ApprovalText>
      </ApprovalDetails>
      <ApprovalText tone="muted">{t(prompt.crypto.operation === 'encrypt' ? 'applications.crypto_encrypt_notice' : 'applications.crypto_decrypt_notice')}</ApprovalText>
    </> : <>
      <NappletRequiredAccess release={{ required }} showHeading={false} />
    </>}
    {!hideActions && anchor ? <SigningDurationMenu standalone anchor={anchor} duration={duration} onChange={setDuration} onClose={() => setAnchor(null)} /> : null}
    {!hideActions ? <CapabilityActions prompt={prompt} duration={duration} menuOpen={anchor !== null} onMenuChange={setAnchor} /> : null}
  </View>;
}
