import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { AppCard } from '@/components/common/AppCard';
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
import { NappletIdentity } from './NappletIdentity';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';

export function signingAction(scope: Pick<SigningScope, 'operation' | 'kind'>, t: TFunction): string {
  if (scope.operation === 'get-public-key') return t('napplets.signing_get_public_key');
  if (isSignerAccess(scope)) return `${t(scope.operation.endsWith('-encrypt') ? 'napplets.crypto_encrypt' : 'napplets.crypto_decrypt')} · ${scope.operation.startsWith('nip04') ? 'NIP-04' : 'NIP-44'}`;
  if (scope.operation === 'sign') return t('napplets.signing_sign_event');
  if (scope.operation === 'relay-auth') return t('napplets.signing_auth');
  if (scope.operation === 'upload') return t('napplets.signing_upload');
  if (scope.operation === 'encrypt-publish') return t('napplets.signing_encrypt');
  const known: Record<number, string> = {
    1: 'signing_post', 6: 'signing_repost', 7: 'signing_reaction',
    30023: 'signing_article', 30078: 'signing_app_data',
  };
  return scope.kind !== undefined && known[scope.kind] ? t(`napplets.${known[scope.kind]}`) : t('napplets.signing_unknown', { kind: scope.kind });
}

export function signingRequestTitle(scope: Pick<SigningScope, 'operation' | 'kind'>, t: TFunction): string {
  if (isSignerAccess(scope) && scope.operation !== 'get-public-key') return t(scope.operation.endsWith('-encrypt') ? 'napplets.crypto_encrypt' : 'napplets.crypto_decrypt');
  return signingAction(scope, t);
}

export function signingEventType(kind: number, t: TFunction): string | undefined {
  const known: Record<number, string> = {
    0: 'event_profile', 1: 'event_post', 3: 'event_follows', 6: 'event_repost', 7: 'event_reaction',
    10002: 'event_relays', 22242: 'event_relay_auth', 27235: 'event_http_auth',
    30023: 'event_article', 30078: 'event_app_data',
  };
  return known[kind] ? t(`napplets.${known[kind]}`) : undefined;
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
    accessible accessibilityRole="image" accessibilityLabel={`${t('napplets.signing_account')}: ${name}`}>
    <Avatar pubkey={pubkey} picture={profile?.picture} size={uiDensity.headerActionSize - borderWidth * 2} />
  </View>;
}

export function SigningRequester({ app, application }: { app?: NappletRelease; application?: import('@/services/explore/model').ApplicationInfo }) {
  const identity=application??app;
  return identity ? <NappletIdentity release={identity} compact iconSize={spacing['2xl'] + spacing.sm}
    titleVariant="body" subtitle={application?.origin} /> : null;
}

export function SigningScopeDetails({ scope }: { scope: SigningScope }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: spacing.sm }}>
      {scope.operation === 'encrypt-publish' ? <SigningText>{signingAction({ ...scope, operation: 'publish' }, t)}</SigningText> : null}
      {scope.scopeKey !== undefined ? <SigningText>{t(scope.kind !== undefined && scope.kind >= 30000 && scope.kind < 40000 ? 'napplets.signing_record' : 'napplets.signing_scope_key')}: {scope.scopeKey || t('napplets.signing_unnamed')}</SigningText> : null}
      {scope.recipient ? <SigningIdentity pubkey={scope.recipient} label={t('napplets.signing_recipient')} /> : null}
      {scope.operation === 'relay-auth' ? !scope.scopeKey ? <SigningText>{t('napplets.signing_auth_scope')}</SigningText> : null : <>
        <SigningText variant="caption" tone="muted">{t(scope.operation === 'upload' ? 'napplets.upload_destinations' : 'napplets.signing_destinations')}</SigningText>
        {scope.relays.map((relay) => <SigningText key={relay} variant="caption">{relay}</SigningText>)}
      </>}
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
  const references = useMemo(() => request.tags.filter(tag => ['e', 'a', 'url', 'method', 'relay'].includes(tag[0]) && tag[1]), [request]);
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
    <SigningText>{t(request.operation === 'get-public-key' ? 'napplets.signing_get_public_key_notice'
      : request.operation.endsWith('-encrypt') ? 'napplets.crypto_encrypt_notice' : 'napplets.crypto_decrypt_notice')}</SigningText>
    {request.operation === 'get-public-key' ? <AppCard variant="muted" style={{ gap: spacing.sm }}>
      <SigningText variant="caption" tone="muted">{t('profile.public_key')}</SigningText>
      <SigningText variant="code">{request.accountPubkey}</SigningText>
    </AppCard> : <AppCard variant="muted" style={{ gap: spacing.md }}>
      <SigningText>{request.operation.startsWith('nip04') ? 'NIP-04' : 'NIP-44'}</SigningText>
    </AppCard>}
    {request.operation.endsWith('-encrypt') ? <EncryptionPlaintext text={request.content} /> : null}
  </View>;
  const auth = request.operation === 'relay-auth';
  const effect = request.operation === 'sign' ? 'signing_effect_sign' : auth ? 'signing_effect_auth' : request.operation === 'encrypt-publish' ? 'signing_effect_encrypted' : 'signing_effect_publish';
  const showIdentifier = isAddressableKind(request.kind);
  const eventType = signingEventType(request.kind, t);
  const eventMetadata = eventType ? `${eventType} · ${request.kind}` : String(request.kind);
  const dTag = request.tags.find((tag) => tag[0] === 'd');
  const title = request.kind === 30023 ? request.tags.find((tag) => tag[0] === 'title')?.[1] : undefined;
  const metadata = <>
    <View style={{ gap: spacing.sm }}>
      <SigningText variant="caption" tone="muted">{t('napplets.signing_kind')}</SigningText>
      <SigningText>{eventMetadata}</SigningText>
    </View>
    {showIdentifier ? <View style={{ gap: spacing.sm }}>
      <SigningText variant="caption" tone="muted">d</SigningText>
      <SigningText numberOfLines={3}>
        {dTag ? dTag[1] || t('napplets.signing_unnamed') : t('napplets.none')}
      </SigningText>
    </View> : null}
  </>;
  return <View style={{ gap: spacing.lg }}>
    {showTitle ? <SigningText variant="title">{signingRequestTitle(request, t)}</SigningText> : null}
    {request.operation === 'encrypt-publish' ? <SigningText tone="muted">{t(`napplets.${effect}`)}</SigningText> : null}
    {auth ? <AppCard variant="muted" style={{ gap: spacing.lg }}>
      {metadata}
      <SigningText>{new URL(request.relays[0]).host}</SigningText>
    </AppCard> : <>
      {request.recipient ? <SigningIdentity pubkey={request.recipient} label={t('napplets.signing_recipient')} /> : null}
      <AppCard variant="muted" style={{ gap: spacing.lg }}>
        {metadata}
        {request.content.length > 0 ? <View style={{ gap: spacing.sm }}>
          <SigningText variant="caption" tone="muted">{t('napplets.signing_content')}</SigningText>
          {title ? <SigningText>{title}</SigningText> : null}
          {preview.fields.length ? preview.fields.map(([key, value]) => <View key={key} style={{ flexDirection: 'row', gap: spacing.md }}>
            <SigningText variant="caption" tone="muted" style={{ flex: 1 }}>{key.slice(0, 80)}</SigningText>
            <SigningText style={{ flex: 2 }}>{String(value).slice(0, 140)}</SigningText>
          </View>) : previewText ? <SigningText>{previewText.slice(0, 600)}</SigningText> : null}
        </View> : null}
        {references.slice(0, 4).map((tag, index) => <View key={index} style={{ gap: spacing.xs }}>
          <SigningText variant="caption" tone="muted">{['e', 'a'].includes(tag[0]) ? t('chat.event_reference.event')
              : tag[0] === 'method' ? 'HTTP' : t('napplets.signing_destinations')}</SigningText>
          <SigningText numberOfLines={2}>{tag[1].slice(0, 256)}</SigningText>
        </View>)}
        {preview.truncated || previewText.length > 600 || references.length > 4 || references.some(tag => tag[1].length > 256) ? <SigningText variant="caption" tone="muted">{t('napplets.signing_truncated')}</SigningText> : null}
      </AppCard>
    </>}
    {request.operation !== 'encrypt-publish' ? <SigningText tone="muted">{t(`napplets.${effect}`)}</SigningText> : null}
    <View style={{ alignSelf: 'center' }}>
      <AppButton variant="text" labelWeight="regular" label={t(details ? 'napplets.signing_hide_details' : 'napplets.signing_details')}
        accessibilityState={{ expanded: details }}
        iconRight={details ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />}
        onPress={() => setDetails(!details)} />
    </View>
    {details ? <View style={{ gap: spacing.lg }}>
      <EventJson request={request} />
      {request.relays.length ? <View style={{ gap: spacing.sm }}>
        <SigningText variant="caption" tone="muted">{t('napplets.signing_destinations')}</SigningText>
        {request.relays.map((relay) => <SigningText key={relay} variant="caption">{relay}</SigningText>)}
      </View> : null}
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
  return <AppCard variant="muted" style={{ gap: spacing.sm }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <SigningText variant="caption" tone="muted" style={{ flex: 1 }}>{t('napplets.crypto_plaintext')}</SigningText>
      <AppButton variant="text" compact labelWeight="regular" label={t(copied ? 'common.copied' : 'common.copy')}
        iconLeft={copied ? <Check size={spacing.lg} color={c.text} /> : <Copy size={spacing.lg} color={c.text} />}
        onPress={() => { void copyText(text); }} />
    </View>
    <SigningText>{expanded ? text : text.slice(0, 600)}</SigningText>
    {truncated && !expanded ? <SigningText variant="caption" tone="muted">{t('napplets.signing_truncated')}</SigningText> : null}
    {truncated ? <AppButton variant="text" labelWeight="regular"
      label={t(expanded ? 'napplets.signing_hide_details' : 'napplets.signing_details')}
      accessibilityState={{ expanded }}
      iconRight={expanded ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />}
      onPress={() => setExpandedFor(expanded ? undefined : text)} /> : null}
  </AppCard>;
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

/** Signing content scrolls as one surface; explicit actions handle copying. */
function SigningText({ style, ...props }: ComponentProps<typeof AppText>) {
  return <AppText {...props} selectable={false} style={[style, styles.text]} />;
}

const styles = StyleSheet.create({ text: { userSelect: 'none' } });
