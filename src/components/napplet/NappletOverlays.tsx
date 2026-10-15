import { useRef, useState } from 'react';
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
import { nappletService } from '@/services/napplet/service';
import type { ConfigSchema } from '@/services/napplet/config';
import { getNappletAccountPubkey, useNapplets } from '@/stores/napplet.store';
import { contentWidth, spacing, useThemeColors } from '@/theme';
import { SigningApproval, SigningActions, SigningDurationMenu } from './SigningApproval';
import { SigningIdentity, SigningRequester, SigningAccountAvatar, signingAction } from './SigningRequestDetails';
import { NappletIcon } from './NappletIcon';
import { CapabilityApproval } from './CapabilityApproval';

export function NappletOverlays() {
  const { prompt, configuration, panel, accountPubkey } = useNapplets();
  const pending = useRef<(() => void) | null>(null);
  const { t } = useTranslation();
  const [choice, setChoice] = useState<{ id: string; value: string }>();
  const [menu, setMenu] = useState<{ id: string; anchor: ContextMenuAnchor }>();
  const menuOpen = !!prompt && menu?.id === prompt.requestId;
  const duration = choice?.id === prompt?.requestId ? choice?.value ?? 'allow' : 'allow';
  const showingPanel = prompt || configuration ? null : panel;
  function panelAction(action: NappletPanelAction | 'settings') {
    if (!panel || !accountPubkey) return;
    if (action === 'settings') { nappletService.openPanel('settings'); return; }
    const release = panel.release;
    const account = accountPubkey;
    pending.current = () => {
      if (getNappletAccountPubkey() !== account) return;
      if (action === 'publisher') router.push(`/profile/${release.event.pubkey}`);
      else if (action === 'share') {
        const draftId = useForwardDraftStore.getState().start({ accountPubkey: account, sourceConversationKey: null,
          messages: [{ kind: KIND_CHAT, content: `${release.title}\n${appShareAddress(release)}`, tags: [] }] });
        try { nappletService.startShare(account, release); }
        catch { useForwardDraftStore.getState().discard(draftId); }
      } else void nappletService.reload(release, account).catch(() => showToast(t('napplets.request_failed')));
    };
    nappletService.closePanel();
  }
  return (
    <BottomSheet
      visible={!!prompt || !!configuration || !!panel}
      title={prompt?.signing ? signingAction(prompt.signing, t) : prompt?.title ?? (showingPanel?.page === 'about' ? t('napplets.details') : t('napplets.settings'))}
      headerAction={prompt?.signing ? <SigningAccountAvatar pubkey={prompt.signing.accountPubkey} /> : showingPanel?.page === 'settings' && accountPubkey ? <SigningAccountAvatar pubkey={accountPubkey} /> : undefined}
      maxWidth={contentWidth.focused}
      contentStyle={{ gap: spacing.lg }}
      scrollResetKey={prompt?.requestId ?? (configuration ? 'configuration' : panel?.page ?? 'closed')}
      onClosed={() => { nappletService.overlayClosed(); const work = pending.current; pending.current = null; work?.(); }}
      onClose={() => {
        if (menuOpen) { setMenu(undefined); return; }
        if (prompt) nappletService.rejectAllRequests();
        nappletService.closeConfiguration();
        if (!prompt && !configuration) nappletService.closePanel();
      }}
      modalOverlay={prompt?.signing && menuOpen && menu ? <SigningDurationMenu anchor={menu.anchor} duration={duration}
        onChange={(value) => setChoice({ id: prompt.requestId, value })} onClose={() => setMenu(undefined)} /> : undefined}
      fixedFooter={prompt?.signing ? <View style={{ gap: spacing.sm }}>
        <SigningActions prompt={prompt} duration={duration} menuOpen={menuOpen}
          onMenuChange={(anchor) => setMenu(anchor ? { id: prompt.requestId, anchor } : undefined)} />
      </View> : showingPanel?.page === 'about' ? <NappletPanelActions onAction={panelAction} /> : undefined}
    >
      {prompt ? <>
        {prompt.signing ? <SigningRequester app={prompt.app} /> : <>
          <AppText>{t('napplets.permission_notice')}</AppText>
          {prompt.app ? <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <NappletIcon release={prompt.app} />
            <AppText variant="subtitle" style={{ flex: 1 }}>{prompt.app.title}</AppText>
          </View> : null}
          {prompt.accountPubkey ? <SigningIdentity pubkey={prompt.accountPubkey} label={t('napplets.signing_account')} /> : null}
          {prompt.app ? <SigningIdentity pubkey={prompt.app.event.pubkey} label={t('napplets.publisher')} /> : null}
        </>}
        {prompt.queued ? <AppText variant="caption" tone="muted">{t('napplets.signing_queued', { count: prompt.queued })}</AppText> : null}
        {prompt.signing ? <SigningApproval key={prompt.requestId} prompt={prompt} value={duration}
          onChange={(value) => setChoice({ id: prompt.requestId, value })} hideActions />
          : prompt.capabilities ? <CapabilityApproval key={prompt.requestId} prompt={prompt} /> : <>
            <AppText variant="code">{prompt.detail}</AppText>
            {prompt.choices ? <>
              {prompt.choices.map((option) => <AppButton key={option.key} variant="secondary" label={option.title}
                onPress={() => nappletService.answer(prompt.requestId, option.key)} />)}
              <AppButton variant="ghost" label={t('common.cancel')} onPress={() => nappletService.answer(prompt.requestId, false)} />
            </> : <ActionRow layout="vertical"
              confirm={{ label: t('napplets.allow'), onPress: () => nappletService.answer(prompt.requestId, 'allow') }}
              dismiss={{ label: t('common.cancel'), onPress: () => nappletService.answer(prompt.requestId, false) }} />}
          </>}
        {!prompt.signing && prompt.queued ? <AppButton variant="ghost" label={t('napplets.signing_reject_all')} onPress={() => nappletService.rejectAllRequests()} /> : null}
      </> : configuration ? <ConfigEditor configuration={configuration} /> : panel && accountPubkey ?
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
