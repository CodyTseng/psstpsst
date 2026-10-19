import { platform } from '@/platform';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { appShareAddress } from '@/services/napplet/protocol';
import { KIND_CHAT } from '@/services/crypto/nip17-gift-wrap';
import { showToast } from '@/stores/toast.store';
import { NappletPanel, NappletPanelActions, type NappletPanelAction } from './NappletPanel';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { ActionRow } from '@/components/common/ActionRow';
import type { ContextMenuAnchor } from '@/components/common/ContextMenu';
import { BottomSheet } from '@/components/common/BottomSheet';
import { nappletService, nappletStore } from '@/services/napplet/service';
import type { ConfigSchema } from '@/services/napplet/config';
import { getNappletAccountPubkey, useNapplets } from '@/stores/napplet.store';
import { contentWidth, spacing, useThemeColors } from '@/theme';
import { SigningApproval, SigningActions, SigningDurationMenu } from './SigningApproval';
import { SigningIdentity, SigningRequester, SigningAccountAvatar, signingAction } from './SigningRequestDetails';
import { NappletIdentity } from './NappletIdentity';
import { UploadApproval } from './UploadApproval';
import { CapabilityApproval } from './CapabilityApproval';
import type { RuntimePromptChoice } from '@/services/napplet/runtime';
import { ApplicationChoiceRow } from './ApplicationChoiceRow';
import { useOwnsApplicationTaskOverlays } from './ApplicationTaskContext';

export function NappletOverlays() {
  const owns = useOwnsApplicationTaskOverlays();
  useEffect(() => {
    if (!owns) return;
    const state = nappletStore.getState();
    // A task switch can unmount the previous owner's sheet during its exit animation.
    if (!state.prompt && !state.configuration && !state.panel) nappletService.overlayClosed();
  }, [owns]);
  return owns ? <NappletOverlayContent /> : null;
}

function NappletOverlayContent() {
  const { prompt, configuration, panel, accountPubkey } = useNapplets();
  const pending = useRef<(() => void) | null>(null);
  const { t } = useTranslation();
  const [choice, setChoice] = useState<{ id: string; value: string }>();
  const [menu, setMenu] = useState<{ id: string; anchor: ContextMenuAnchor }>();
  const menuOpen = !!prompt && menu?.id === prompt.requestId;
  const duration = choice?.id === prompt?.requestId ? choice?.value ?? 'allow' : 'allow';
  const showingPanel = prompt || configuration ? null : panel;
  const selectingApplication = prompt?.applicationSelection;
  function panelAction(action: NappletPanelAction | 'settings') {
    if (!panel || !accountPubkey) return;
    if (action === 'settings') { nappletService.openPanel('settings'); return; }
    const release = panel.release;
    const account = accountPubkey;
    pending.current = () => {
      if (getNappletAccountPubkey() !== account) return;
      if (action === 'publisher') { if (platform.napplet.windows?.isHost) void platform.napplet.windows.action({type:'profile',pubkey:release.event.pubkey}); else router.push(`/profile/${release.event.pubkey}`); }
      else if (action === 'share') {
        if (platform.napplet.windows?.isHost) { void platform.napplet.windows.action({type:'share',accountPubkey:account,title:release.title,address:appShareAddress(release)}); return; }
        const draftId = useForwardDraftStore.getState().start({ accountPubkey: account, sourceConversationKey: null,
          messages: [{ kind: KIND_CHAT, content: `${release.title}\n${appShareAddress(release)}`, tags: [] }] });
        try { nappletService.startShare(account, release); }
        catch { useForwardDraftStore.getState().discard(draftId); }
      } else void nappletService.reload(release, account).catch(() => showToast(t('napplets.request_failed')));
    };
    nappletService.closePanel();
  }
  return (
    <BottomSheet<RuntimePromptChoice>
      visible={!!prompt || !!configuration || !!panel}
      title={selectingApplication ? t('napplets.open_with_title') : prompt?.device ? t(prompt.device.operation === 'save-file' ? 'common.save' : 'common.copy') : prompt?.crypto ? t(prompt.crypto.operation === 'encrypt' ? 'napplets.crypto_encrypt' : 'napplets.crypto_decrypt') : prompt?.signing ? signingAction(prompt.signing, t) : prompt?.upload ? t('napplets.signing_upload') : prompt?.title ?? (showingPanel?.page === 'about' ? t('napplets.details') : showingPanel?.page === 'settings' ? t('napplets.permissions_manage') : t('napplets.settings'))}
      headerAction={prompt?.signing ? <SigningAccountAvatar pubkey={prompt.signing.accountPubkey} /> : showingPanel?.page === 'settings' && accountPubkey ? <SigningAccountAvatar pubkey={accountPubkey} /> : undefined}
      maxWidth={contentWidth.focused}
      contentStyle={selectingApplication ? undefined : { gap: spacing.lg, ...((prompt?.capabilities || prompt?.application && !prompt.signing && !prompt.upload) ? { paddingTop: spacing.sm } : {}) }}
      fixedSubheader={selectingApplication ? <AppText style={{ paddingTop: spacing.sm, paddingBottom: spacing.sm }}>
        {t(selectingApplication.content === 'profile' ? 'napplets.open_with_profile' : 'napplets.open_with_content', { app: selectingApplication.requester })}
      </AppText> : undefined}
      listProps={selectingApplication && prompt ? {
        data: prompt.choices ?? [], keyExtractor: choice => choice.key,
        initialNumToRender: 8,
        contentContainerStyle: { paddingBottom: spacing.lg },
        renderItem: ({ item }) => <ApplicationChoiceRow choice={item} requestId={prompt.requestId}/>,
      } : undefined}
      scrollResetKey={prompt?.requestId ?? (configuration ? 'configuration' : panel?.page ?? 'closed')}
      onClosed={() => { nappletService.overlayClosed(); const work = pending.current; pending.current = null; work?.(); }}
      onClose={() => {
        if (menuOpen) { setMenu(undefined); return; }
        if (prompt) { nappletService.answer(prompt.requestId, false); return; }
        nappletService.closeConfiguration();
        if (!prompt && !configuration) nappletService.closePanel();
      }}
      modalOverlay={prompt?.signing && menuOpen && menu ? <SigningDurationMenu anchor={menu.anchor} duration={duration}
        onChange={(value) => setChoice({ id: prompt.requestId, value })} onClose={() => setMenu(undefined)} /> : undefined}
      fixedFooter={prompt?.signing ? <View style={{ gap: spacing.sm }}>
        <SigningActions prompt={prompt} duration={duration} menuOpen={menuOpen}
          onMenuChange={(anchor) => setMenu(anchor ? { id: prompt.requestId, anchor } : undefined)} />
      </View> : showingPanel?.page === 'about' ? <NappletPanelActions address={appShareAddress(showingPanel.release)} onAction={panelAction} /> : undefined}
    >
      {selectingApplication ? null : prompt ? <>
        {prompt.requester && !prompt.application ? <View style={{ gap: spacing.xs }}>
          <AppText variant="subtitle">{prompt.requester.title}</AppText>
          <AppText variant="caption" tone="muted">{prompt.requester.origin}</AppText>
        </View> : null}
        {prompt.signing || prompt.upload ? <SigningRequester app={prompt.app} application={prompt.application} /> : !prompt.capabilities && !prompt.application ? <>
          <AppText>{t('napplets.permission_notice')}</AppText>
          {prompt.app ? <NappletIdentity release={prompt.app} compact /> : null}
          {prompt.accountPubkey ? <SigningIdentity pubkey={prompt.accountPubkey} label={t('napplets.signing_account')} /> : null}
          {prompt.app ? <SigningIdentity pubkey={prompt.app.event.pubkey} label={t('napplets.publisher')} /> : null}
        </> : null}
        {prompt.queued ? <AppText variant="caption" tone="muted">{t('napplets.signing_queued', { count: prompt.queued })}</AppText> : null}
        {prompt.upload ? <UploadApproval prompt={prompt} hideActions={!!prompt.signing} /> : prompt.signing ? <SigningApproval key={prompt.requestId} prompt={prompt} value={duration}
          onChange={(value) => setChoice({ id: prompt.requestId, value })} hideActions />
          : prompt.capabilities || prompt.application ? <CapabilityApproval key={prompt.requestId} prompt={prompt} onPublisher={() => {
            const pubkey = prompt.application?.publisher ?? prompt.app?.event.pubkey;
            if (!pubkey) return;
            const account = accountPubkey;
            pending.current = () => { if (getNappletAccountPubkey() !== account) return;
              if (platform.napplet.windows?.isHost) void platform.napplet.windows.action({ type: 'profile', pubkey });
              else if (platform.napplet.tasks) void platform.napplet.tasks.showHost().then(() => router.push(`/profile/${pubkey}`)).catch(() => showToast(t('napplets.request_failed')));
              else router.push(`/profile/${pubkey}`); };
            nappletService.answer(prompt.requestId, false);
          }} /> : <>
            <AppText variant="code">{prompt.detail}</AppText>
            {prompt.choices ? <>
              {prompt.choices.map((option) => <AppButton key={option.key} variant="secondary" label={option.title}
                onPress={() => nappletService.answer(prompt.requestId, option.key)} />)}
              <AppButton variant="ghost" label={t('common.cancel')} onPress={() => nappletService.answer(prompt.requestId, false)} />
            </> : <ActionRow layout="horizontal"
              confirm={{ label: t('napplets.allow'), onPress: () => nappletService.answer(prompt.requestId, 'allow') }}
              dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} />}
          </>}
        {!prompt.signing && prompt.queued ? <AppButton variant="ghost" label={t('napplets.signing_reject_all')} onPress={() => nappletService.rejectAllRequests()} /> : null}
      </> : configuration ? <ConfigEditor key={configuration.requestId ?? 'napplet'} configuration={configuration} /> : panel && accountPubkey ?
        <NappletPanel key={`${accountPubkey}:${panel.release.key}:${panel.release.hash}:${panel.page}`}
          release={panel.release} page={panel.page} accountPubkey={accountPubkey} onAction={panelAction} /> : null}
    </BottomSheet>
  );
}
function ConfigEditor({
  configuration,
}: {
  configuration: { schema: ConfigSchema; values: Record<string, unknown> };
}) {
  const [values, setValues] = useState(configuration.values);
  const [error, setError] = useState(false);
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <>
      <ConfigFields
        schema={configuration.schema}
        value={values}
        onChange={(next) => setValues(next as Record<string, unknown>)}
      />
      {error ? (
        <AppText style={{ color: c.danger }}>{t('napplets.invalid_settings')}</AppText>
      ) : null}
      <ActionRow layout="vertical"
        confirm={{ label: t('common.save'), onPress: () => {
          void nappletService.saveConfiguration(values).catch(() => setError(true));
        } }}
        dismiss={{ label: t('common.cancel'), onPress: () => nappletService.closeConfiguration() }} />
    </>
  );
}

function ConfigFields({
  schema,
  value,
  onChange,
  label,
}: {
  schema: ConfigSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  label?: string;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  if (schema.type === 'object')
    return (
      <View style={{ gap: spacing.md }}>
        {Object.entries(schema.properties ?? {}).map(([key, child]) => (
          <ConfigFields
            key={key}
            schema={child}
            value={(value as Record<string, unknown>)?.[key]}
            label={child.title ?? key}
            onChange={(next) => onChange({ ...(value as object), [key]: next })}
          />
        ))}
      </View>
    );
  if (schema.type === 'boolean')
    return (
      <AppButton
        variant="secondary"
        label={`${label}: ${t(value ? 'napplets.yes' : 'napplets.no')}`}
        onPress={() => onChange(!value)}
      />
    );
  if (schema.enum)
    return (
      <View style={{ gap: spacing.sm }}>
        <AppText>{label}</AppText>
        {schema.enum.map((item, index) => (
          <AppButton
            key={index}
            variant="secondary"
            selected={JSON.stringify(value) === JSON.stringify(item)}
            label={String(item)}
            onPress={() => onChange(item)}
          />
        ))}
      </View>
    );
  return (
    <AppInput
      label={label}
      description={schema.description}
      value={value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)}
      onChangeText={(next) => {
        if (schema.type === 'array') {
          try {
            onChange(JSON.parse(next));
          } catch {
            onChange(next);
          }
        } else
          onChange(schema.type === 'number' || schema.type === 'integer' ? Number(next) : next);
      }}
      style={{ color: c.text }}
    />
  );
}
