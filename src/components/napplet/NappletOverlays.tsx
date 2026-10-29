import { useActiveAccount } from '@/stores/active-account.store';
import { router } from 'expo-router';
import { Compass } from '@solar-icons/react-native/category/map/Linear/Compass';
import { useExploreSearchHandoffStore } from '@/stores/explore-search-handoff.store';
import { useOpenPublisher } from '@/hooks/use-open-publisher';
import { platform } from '@/platform';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { fromNapplet } from '@/services/explore/model';
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
import { SigningRequester, SigningAccountAvatar, signingRequestTitle } from './SigningRequestDetails';
import { ApprovalText } from './ApprovalDetails';
import { UploadApproval } from './UploadApproval';
import { CapabilityActions, CapabilityApproval } from './CapabilityApproval';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import type { RuntimePromptChoice } from '@/services/napplet/runtime';
import { WalletApproval } from './WalletApproval';
import { ApplicationChoiceRow } from './ApplicationChoiceRow';
import { useOwnsApplicationTaskOverlays } from './ApplicationTaskContext';

export function NappletOverlays() {
  const owns = useOwnsApplicationTaskOverlays();
  useEffect(() => {
    if (!owns) return;
    const state = nappletStore.getState();
    // A task switch can unmount the previous owner's sheet during its exit animation.
    if (state.approvalClosing || !state.prompt && !state.configuration && !state.panel) nappletService.overlayClosed();
  }, [owns]);
  return owns ? <NappletOverlayContent /> : null;
}

function NappletOverlayContent() {
  const openPublisher = useOpenPublisher();
  const colors = useThemeColors();
  const { prompt, approvalClosing, configuration, panel, accountPubkey } = useNapplets();
  const pending = useRef<(() => void) | null>(null);
  const [lastWalletPrompt, setLastWalletPrompt] = useState<QueuedPrompt | null>(null);
  const currentWalletPrompt = prompt?.wallet ? prompt : null;
  if (currentWalletPrompt !== lastWalletPrompt && (currentWalletPrompt || !approvalClosing)) setLastWalletPrompt(currentWalletPrompt);
  const walletPrompt = currentWalletPrompt ?? (approvalClosing ? lastWalletPrompt : null);
  const { t } = useTranslation();
  const [choice, setChoice] = useState<{ id: string; value: string }>();
  const [menu, setMenu] = useState<{ id: string; anchor: ContextMenuAnchor }>();
  const menuOpen = !!prompt && menu?.id === prompt.requestId;
  const duration = choice?.id === prompt?.requestId ? choice?.value ?? 'allow' : 'allow';
  const showingPanel = prompt || configuration ? null : panel;
  const selectingApplication = prompt?.applicationSelection;
  const accessPrompt = !!prompt && !prompt.signing && !prompt.upload && !selectingApplication
    && !!(prompt.capabilities || prompt.application || prompt.browser || prompt.device || prompt.crypto);
  const requestAccount = prompt?.signing?.accountPubkey ?? prompt?.accountPubkey;
  function panelAction(action: NappletPanelAction | 'settings') {
    if (!panel || !accountPubkey) return;
    if (action === 'settings') { nappletService.openPanel('settings'); return; }
    const release = panel.release;
    const account = accountPubkey;
    pending.current = () => {
      if (getNappletAccountPubkey() !== account) return;
      if (action === 'publisher') openPublisher(release.event.pubkey);
      else if (action === 'share') {
        if (platform.napplet.windows?.isHost) { void platform.napplet.windows.action({type:'share',accountPubkey:account,title:release.title,address:appShareAddress(release)}); return; }
        const draftId = useForwardDraftStore.getState().start({ accountPubkey: account, sourceConversationKey: null,
          messages: [{ kind: KIND_CHAT, content: appShareAddress(release), tags: [] }] });
        try { nappletService.startShare(account, release); }
        catch { useForwardDraftStore.getState().discard(draftId); }
      } else void nappletService.reload(release, account).catch(() => showToast(t('applications.request_failed'), { variant: 'error' }));
    };
    nappletService.closePanel();
  }
  if (walletPrompt) return <WalletApproval key={walletPrompt.requestId} prompt={walletPrompt}
    visible={!approvalClosing} onClosed={() => nappletService.overlayClosed()} />;
  return (
    <BottomSheet<RuntimePromptChoice>
      visible={!approvalClosing && (!!prompt || !!configuration || !!panel)}
      dismissOnBackdropPress={!prompt || !!selectingApplication}
      title={selectingApplication ? t('applications.open_with_title') : prompt?.device ? t(prompt.device.operation === 'save-file' ? 'common.save' : 'common.copy') : prompt?.crypto ? t(prompt.crypto.operation === 'encrypt' ? 'applications.crypto_encrypt' : 'applications.crypto_decrypt') : prompt?.signing ? signingRequestTitle(prompt.signing, t) : prompt?.upload ? t('applications.signing_upload') : prompt?.browser ? t(prompt.browser.action === 'permission' ? 'applications.permissions' : `applications.browser_${prompt.browser.action}`) : accessPrompt ? t('applications.permissions') : prompt?.title ?? (showingPanel?.page === 'about' ? t('applications.details') : showingPanel?.page === 'settings' ? t('applications.permissions_manage') : t('applications.settings'))}
      headerAction={requestAccount && !selectingApplication ? <SigningAccountAvatar pubkey={requestAccount} /> : showingPanel?.page === 'settings' && accountPubkey ? <SigningAccountAvatar pubkey={accountPubkey} /> : undefined}
      maxWidth={contentWidth.focused}
      fixedSubheader={selectingApplication && !!prompt?.choices?.length ? <AppText>
        {t(selectingApplication.content === 'profile' ? 'applications.open_with_profile' : 'applications.open_with_content', { app: selectingApplication.requester })}
      </AppText> : undefined}
      listProps={selectingApplication && prompt ? {
        data: prompt.choices ?? [], keyExtractor: choice => choice.key,
        initialNumToRender: 8,
        contentContainerStyle: { paddingBottom: prompt.choices?.length ? spacing.lg : 0 },
        ListEmptyComponent: <View style={{ alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md }}>
          <Compass size={spacing['2xl']} color={colors.textMuted} />
          <AppText variant="body" tone="muted" align="center">
            {selectingApplication.discovery
              ? t('applications.open_with_empty', { app: selectingApplication.requester })
              : t('applications.handler_closed')}
          </AppText>
        </View>,
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
      modalOverlay={prompt && menuOpen && menu ? <SigningDurationMenu anchor={menu.anchor} duration={duration}
        onChange={(value) => setChoice({ id: prompt.requestId, value })} onClose={() => setMenu(undefined)} /> : undefined}
      fixedFooter={selectingApplication?.discovery && prompt && !prompt.choices?.length ? <AppButton label={t('applications.discover')} onPress={() => {
        const filter = selectingApplication.discovery!;
        const account = prompt.accountPubkey;
        if (!account) return;
        pending.current = () => {
          if (useActiveAccount.getState().activePubkey !== account) return;
          if (platform.napplet.windows?.isHost) {
            void platform.napplet.windows.action({ type: 'discover', accountPubkey: account, ...filter }).catch(() => showToast(t('applications.request_failed'), { variant: 'error' }));
            return;
          }
          const id = useExploreSearchHandoffStore.getState().start({ account, value: '', action: filter });
          router.navigate({ pathname: '/explore', params: { searchHandoff: String(id) } });
          void platform.napplet.tasks?.showHost().catch(() => showToast(t('applications.request_failed'), { variant: 'error' }));
        };
        nappletService.answer(prompt.requestId, false);
      }} /> : prompt?.signing || accessPrompt ? <View style={{ gap: spacing.sm }}>
        {prompt?.signing ? <SigningActions prompt={prompt} duration={duration} menuOpen={menuOpen}
          onMenuChange={(anchor) => setMenu(anchor ? { id: prompt.requestId, anchor } : undefined)} />
          : prompt ? <CapabilityActions prompt={prompt} duration={duration} menuOpen={menuOpen}
            onMenuChange={(anchor) => setMenu(anchor ? { id: prompt.requestId, anchor } : undefined)} /> : null}
      </View> : showingPanel?.page === 'about' ? <NappletPanelActions entry={fromNapplet(showingPanel.release)} account={accountPubkey} onAction={panelAction} /> : undefined}
    >
      {selectingApplication ? null : prompt ? <>
        {prompt.requester && !prompt.application ? <View style={{ gap: spacing.xs }}>
          <ApprovalText>{prompt.requester.title}</ApprovalText>
          <ApprovalText variant="caption" tone="muted">{prompt.requester.origin}</ApprovalText>
        </View> : null}
        {prompt.app || prompt.application ? <SigningRequester app={prompt.app} application={prompt.application} /> : null}
        {prompt.upload ? <UploadApproval prompt={prompt} hideActions={!!prompt.signing} /> : prompt.signing ? <SigningApproval key={prompt.requestId} prompt={prompt} value={duration}
          onChange={(value) => setChoice({ id: prompt.requestId, value })} hideActions />
          : accessPrompt ? <CapabilityApproval key={prompt.requestId} prompt={prompt} hideActions /> : <>
            <ApprovalText>{prompt.detail}</ApprovalText>
            {prompt.choices ? <>
              {prompt.choices.map((option) => <AppButton key={option.key} variant="secondary" label={option.title}
                onPress={() => nappletService.answer(prompt.requestId, option.key)} />)}
              <AppButton variant="ghost" label={t('common.cancel')} onPress={() => nappletService.answer(prompt.requestId, false)} />
            </> : <ActionRow layout="horizontal"
              confirm={{ label: t('applications.allow'), onPress: () => nappletService.answer(prompt.requestId, 'allow') }}
              dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} />}
          </>}
      </> : configuration ? <ConfigEditor key={configuration.requestId ?? 'napplet'} configuration={configuration} /> : panel && accountPubkey ?
        <NappletPanel key={`${accountPubkey}:${panel.release.eventKey}:${panel.release.hash}:${panel.page}`}
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
        <AppText style={{ color: c.danger }}>{t('applications.invalid_settings')}</AppText>
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
        label={`${label}: ${t(value ? 'applications.yes' : 'applications.no')}`}
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
