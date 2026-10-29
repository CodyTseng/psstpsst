import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppButton } from '@/components/common/AppButton';
import { ApprovalDetails, ApprovalField, ApprovalText as SigningText } from './ApprovalDetails';
import { Avatar } from '@/components/common/Avatar';
import { useClipboard } from '@/hooks/use-clipboard';
import Copy from 'lucide-react-native/icons/copy';
import Check from 'lucide-react-native/icons/check';
import { useDisplayName } from '@/hooks/use-display-name';
import { isSignerAccess, type SigningRequest, type SigningScope } from '@/services/signing/model';
import type { NappletRelease } from '@/services/napplet/protocol';
import { isAddressableKind } from 'nostr-tools/kinds';
import { serializeEvent, type UnsignedEvent } from 'nostr-tools';
import { platform } from '@/platform';
import { ApplicationIdentity } from './ApplicationIdentity';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';

export function signingAction(scope: Pick<SigningScope, 'operation' | 'kind'>, t: TFunction): string {
  if (scope.operation === 'get-public-key') return t('applications.signing_get_public_key');
  if (isSignerAccess(scope)) return `${t(scope.operation.endsWith('-encrypt') ? 'applications.crypto_encrypt' : 'applications.crypto_decrypt')} · ${scope.operation.startsWith('nip04') ? 'NIP-04' : 'NIP-44'}`;
  if (scope.operation === 'http-auth') return t('applications.signing_http_auth');
  if (scope.operation === 'relay-auth') return t('applications.signing_auth');
  if (scope.operation === 'upload') return t('applications.signing_upload');
  return t('applications.signing_sign_event');
}

export function signingRequestTitle(scope: Pick<SigningScope, 'operation' | 'kind'>, t: TFunction): string {
  if (isSignerAccess(scope) && scope.operation !== 'get-public-key') return t(scope.operation.endsWith('-encrypt') ? 'applications.crypto_encrypt' : 'applications.crypto_decrypt');
  return signingAction(scope, t);
}

export function signingEventType(kind: number, t: TFunction): string | undefined {
  const known: Record<number, string> = {
    0: 'event_profile', 1: 'event_post', 3: 'event_follows', 6: 'event_repost', 7: 'event_reaction',
    10002: 'event_relays', 22242: 'event_relay_auth', 27235: 'event_http_auth',
    30023: 'event_article', 30078: 'event_app_data',
  };
  return known[kind] ? t(`applications.${known[kind]}`) : undefined;
}

export function SigningIdentity({ pubkey, label }: { pubkey: string; label: string }) {
  const { name, profile } = useDisplayName(pubkey);
  return (
    <View style={{ gap: spacing.sm }}>
      <SigningText variant="caption" tone="muted">{label}</SigningText>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Avatar pubkey={pubkey} picture={profile?.picture} />
        <View style={{ flex: 1 }}>
          <SigningText>{name}</SigningText>
          <SigningText variant="caption" tone="muted">{pubkey.slice(0, 12)}…{pubkey.slice(-8)}</SigningText>
        </View>
      </View>
    </View>
  );
}

export function SigningAccountAvatar({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation();
  const { name, profile } = useDisplayName(pubkey);
  const c = useThemeColors();
  const borderWidth = 1;
  return <View style={{ width: uiDensity.headerActionSize, height: uiDensity.headerActionSize, flexShrink: 0,
    borderWidth, borderColor: c.border, borderRadius: uiDensity.headerActionSize / 2, overflow: 'hidden' }}
    accessible accessibilityRole="image" accessibilityLabel={`${t('applications.signing_account')}: ${name}`}>
    <Avatar pubkey={pubkey} picture={profile?.picture} size={uiDensity.headerActionSize - borderWidth * 2} />
  </View>;
}

export function SigningRequester({ app, application }: { app?: NappletRelease; application?: import('@/services/explore/model').ApplicationInfo }) {
  const identity=application??app;
  return identity ? <ApplicationIdentity release={identity} compact iconSize={spacing['2xl'] + spacing.sm}
    titleVariant="body" subtitle={application?.origin} /> : null;
}

export function SigningScopeDetails({ scope }: { scope: SigningScope }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: spacing.sm }}>
      {scope.scopeKey !== undefined && scope.operation !== 'http-auth' ? <SigningText>{t(scope.kind !== undefined && scope.kind >= 30000 && scope.kind < 40000 ? 'applications.signing_record' : 'applications.signing_scope_key')}: {scope.scopeKey || t('applications.signing_unnamed')}</SigningText> : null}
      {scope.recipient ? <SigningIdentity pubkey={scope.recipient} label={t('applications.signing_recipient')} /> : null}
      {scope.relays.length ? <>
        <SigningText variant="caption" tone="muted">{t(scope.operation === 'upload' ? 'applications.upload_destinations' : 'applications.signing_destinations')}</SigningText>
        {scope.relays.map((relay) => <SigningText key={relay}>{relay}</SigningText>)}
      </> : null}
    </View>
  );
}

/** Interpret only standard event fields; app-provided prose is never an authority claim. */
function previewContent(request: SigningRequest): {
  text: string; fields: [string, unknown][]; truncated?: boolean;
  repost?: { serialized: string; content: string; id: string };
} {
  let value: unknown;
  if (request.content.length <= 65536) {
    try { value = JSON.parse(request.content); } catch { /* Plain text remains literal. */ }
  }
  if (request.kind === 6 && value && typeof value === 'object' && !Array.isArray(value)) {
    const original = value as Record<string, unknown>;
    const reference = request.tags.find((tag) => tag[0] === 'e')?.[1];
    if (original.id === reference && typeof original.content === 'string') {
      try {
        return { text: request.content, fields: [], repost: {
          serialized: serializeEvent(original as unknown as UnsignedEvent), content: original.content, id: reference!,
        } };
      } catch { /* Invalid embedded events remain literal request data. */ }
    }
  }
  if ([0, 30078].includes(request.kind ?? -1) && value && typeof value === 'object' && !Array.isArray(value)) {
    const fields = Object.entries(value).filter(([, item]) => item == null || ['string', 'number', 'boolean'].includes(typeof item));
    if (fields.length) return { text: '', fields: fields.slice(0, 6),
      truncated: fields.length > 6 || fields.length !== Object.keys(value).length ||
        fields.some(([key, item]) => key.length > 80 || String(item).length > 140) };
  }
  return { text: request.content, fields: [] };
}

export function SigningRequestDetails({ request, showTitle = true }: {
  request: SigningRequest; showTitle?: boolean;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [details, setDetails] = useState(false);
  const preview = useMemo(() => previewContent(request), [request]);
  const references = useMemo(() => request.tags.filter(tag => ['e', 'a', 'url', 'method', 'relay'].includes(tag[0]) && tag[1]
    && !(request.kind === 27235 && ['url', 'method'].includes(tag[0]))), [request]);
  const [verified, setVerified] = useState<{ request: SigningRequest; text: string }>();
  useEffect(() => {
    let active = true;
    if (preview.repost) {
      const original = preview.repost;
      void platform.deviceCrypto.sha256Hex(new TextEncoder().encode(original.serialized))
        .then((hash) => {
          if (active && hash === original.id) setVerified({ request, text: original.content });
        }).catch(() => {});
    }
    return () => { active = false; };
  }, [preview.repost, request]);
  const previewText = verified?.request === request ? verified.text : preview.text;
  if (isSignerAccess(request)) return <View style={{ gap: spacing.lg }}>
    {showTitle ? <SigningText variant="title">{signingRequestTitle(request, t)}</SigningText> : null}
    {request.operation === 'get-public-key' ? <ApprovalDetails>
      <ApprovalField label={t('profile.public_key')}>
        <SigningText>{request.accountPubkey}</SigningText>
      </ApprovalField>
    </ApprovalDetails> : <ApprovalDetails>
      <SigningText>{request.operation.startsWith('nip04') ? 'NIP-04' : 'NIP-44'}</SigningText>
    </ApprovalDetails>}
    {request.operation.endsWith('-encrypt') ? <EncryptionPlaintext text={request.content} /> : null}
    <SigningText tone="muted">{t(request.operation === 'get-public-key' ? 'applications.signing_get_public_key_notice'
      : request.operation.endsWith('-encrypt') ? 'applications.crypto_encrypt_notice' : 'applications.crypto_decrypt_notice')}</SigningText>
  </View>;
  const auth = request.operation === 'relay-auth';
  const httpAuth = request.operation === 'http-auth';
  const httpUrl = httpAuth ? request.tags.find(tag => tag[0] === 'u' && tag[1])?.[1]
    ?? request.tags.find(tag => tag[0] === 'url' && tag[1])?.[1] : undefined;
  const httpMethod = httpAuth ? request.tags.find(tag => tag[0] === 'method' && tag[1])?.[1] : undefined;
  const effect = auth ? 'signing_effect_auth' : httpAuth ? 'signing_effect_http_auth' : 'signing_effect_sign';
  const showIdentifier = isAddressableKind(request.kind);
  const eventType = signingEventType(request.kind, t);
  const eventMetadata = eventType ? `${eventType} · ${request.kind}` : String(request.kind);
  const dTag = request.tags.find((tag) => tag[0] === 'd');
  const title = request.kind === 30023 ? request.tags.find((tag) => tag[0] === 'title')?.[1] : undefined;
  const metadata = <>
    <ApprovalField label={t('applications.signing_kind')}>
      <SigningText>{eventMetadata}</SigningText>
    </ApprovalField>
    {showIdentifier ? <ApprovalField label="d">
      <SigningText>
        {dTag ? dTag[1] || t('applications.signing_unnamed') : t('applications.none')}
      </SigningText>
    </ApprovalField> : null}
  </>;
  return <View style={{ gap: spacing.lg }}>
    {showTitle ? <SigningText variant="title">{signingRequestTitle(request, t)}</SigningText> : null}
    {auth ? <ApprovalDetails>
      <ApprovalField label={t('applications.signing_auth_relay')}>
        <SigningText>{request.relays[0]}</SigningText>
      </ApprovalField>
    </ApprovalDetails> : <>
      {request.recipient ? <SigningIdentity pubkey={request.recipient} label={t('applications.signing_recipient')} /> : null}
      <ApprovalDetails>
        {!httpAuth ? metadata : null}
        {httpUrl ? <ApprovalField label={t('applications.signing_service')}>
          <SigningText>{new URL(httpUrl).origin}</SigningText>
        </ApprovalField> : null}
        {httpUrl ? <ApprovalField label={t('applications.signing_url')}>
          <SigningText>{httpUrl}</SigningText>
        </ApprovalField> : null}
        {httpMethod ? <ApprovalField label={t('applications.signing_http_method')}>
          <SigningText>{httpMethod}</SigningText>
        </ApprovalField> : null}
        {request.content.length > 0 ? <ApprovalField label={t('applications.signing_content')}>
          {title ? <SigningText>{title}</SigningText> : null}
          {preview.fields.length ? preview.fields.map(([key, value]) => <View key={key} style={{ flexDirection: 'row', gap: spacing.md }}>
            <SigningText variant="caption" tone="muted" style={{ flex: 1 }}>{key.slice(0, 80)}</SigningText>
            <SigningText style={{ flex: 2 }}>{String(value).slice(0, 140)}</SigningText>
          </View>) : previewText ? <SigningText>{previewText.slice(0, 600)}</SigningText> : null}
        </ApprovalField> : null}
        {references.slice(0, 4).map((tag, index) => <ApprovalField key={index}
          label={['e', 'a'].includes(tag[0]) ? t('chat.event_reference.event')
              : tag[0] === 'method' ? 'HTTP' : t('applications.signing_destinations')}>
          <SigningText numberOfLines={2}>{tag[1].slice(0, 256)}</SigningText>
        </ApprovalField>)}
        {preview.truncated || previewText.length > 600 || references.length > 4 || references.some(tag => tag[1].length > 256) ? <SigningText variant="caption" tone="muted">{t('applications.signing_truncated')}</SigningText> : null}
      </ApprovalDetails>
    </>}
    <SigningText tone="muted">{t(`applications.${effect}`)}</SigningText>
    <View style={{ alignSelf: 'center' }}>
      <AppButton variant="text" labelWeight="regular" label={t(details ? 'applications.signing_hide_details' : 'applications.signing_details')}
        accessibilityState={{ expanded: details }}
        iconRight={details ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />}
        onPress={() => setDetails(!details)} />
    </View>
    {details ? <View style={{ gap: spacing.lg }}>
      <EventJson request={request} />
      {request.relays.length ? <ApprovalField label={t('applications.signing_destinations')}>
        {request.relays.map((relay) => <SigningText key={relay}>{relay}</SigningText>)}
      </ApprovalField> : null}
    </View> : null}
  </View>;
}

/** Review the exact input without parsing or persisting application plaintext. */
function EncryptionPlaintext({ text }: { text: string }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [expandedFor, setExpandedFor] = useState<string>();
  const expanded = expandedFor === text;
  const { copied, copyText } = useClipboard();
  const truncated = text.length > 600;
  return <ApprovalDetails>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <SigningText variant="caption" tone="muted" style={{ flex: 1 }}>{t('applications.crypto_plaintext')}</SigningText>
      <AppButton variant="text" compact labelWeight="regular" label={t(copied ? 'common.copied' : 'common.copy')}
        iconLeft={copied ? <Check size={spacing.lg} color={c.text} /> : <Copy size={spacing.lg} color={c.text} />}
        onPress={() => { void copyText(text); }} />
    </View>
    <SigningText>{expanded ? text : text.slice(0, 600)}</SigningText>
    {truncated && !expanded ? <SigningText variant="caption" tone="muted">{t('applications.signing_truncated')}</SigningText> : null}
    {truncated ? <AppButton variant="text" labelWeight="regular"
      label={t(expanded ? 'applications.signing_hide_details' : 'applications.signing_details')}
      accessibilityState={{ expanded }}
      iconRight={expanded ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />}
      onPress={() => setExpandedFor(expanded ? undefined : text)} /> : null}
  </ApprovalDetails>;
}

function EventJson({ request }: { request: SigningRequest }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { copied, copyText } = useClipboard();
  const json = useMemo(() => JSON.stringify({
    pubkey: request.accountPubkey, kind: request.kind, created_at: request.createdAt,
    content: request.content, tags: request.tags,
  }, null, 2), [request]);
  return <View style={{ gap: spacing.sm }}>
    <View style={{ alignSelf: 'flex-end' }}>
      <AppButton variant="text" label={t(copied ? 'common.copied' : 'common.copy')}
        iconLeft={copied ? <Check size={spacing.lg} color={c.text} /> : <Copy size={spacing.lg} color={c.text} />}
        onPress={() => { void copyText(json); }} />
    </View>
    <SigningText variant="code">{json}</SigningText>
  </View>;
}
