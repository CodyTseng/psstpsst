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
import type { SigningRequest, SigningScope } from '@/services/napplet/signing-permissions';
import type { NappletRelease } from '@/services/napplet/protocol';
import { isReplaceableKind, isAddressableKind } from 'nostr-tools/kinds';
import { serializeEvent, type UnsignedEvent } from 'nostr-tools';
import { formatFileSize } from '@/lib/nostr/file-tags';
import { platform } from '@/platform';
import { NappletIcon } from './NappletIcon';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';

export function signingAction(scope: Pick<SigningScope, 'operation' | 'kind'>, t: TFunction): string {
  if (scope.operation === 'relay-auth') return t('napplets.signing_auth');
  if (scope.operation === 'upload') return t('napplets.signing_upload');
  if (scope.operation === 'encrypt-publish') return t('napplets.signing_encrypt');
  const known: Record<number, string> = {
    1: 'signing_post', 6: 'signing_repost', 7: 'signing_reaction',
    30023: 'signing_article', 30078: 'signing_app_data',
  };
  return known[scope.kind] ? t(`napplets.${known[scope.kind]}`) : t('napplets.signing_unknown', { kind: scope.kind });
}

export function SigningIdentity({ pubkey, label }: { pubkey: string; label: string }) {
  const { name, profile } = useDisplayName(pubkey);
  return (
    <View style={{ gap: spacing.sm }}>
      <SigningText variant="caption" tone="muted">{label}</SigningText>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Avatar pubkey={pubkey} picture={profile?.picture} />
        <View style={{ flex: 1 }}>
          <SigningText variant="subtitle">{name}</SigningText>
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

export function SigningRequester({ app }: { app?: NappletRelease }) {
  return app ? <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingTop: spacing.sm }}>
    <NappletIcon release={app} size={spacing['2xl']} />
    <SigningText variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>{app.title}</SigningText>
  </View> : null;
}

export function SigningScopeDetails({ scope }: { scope: SigningScope }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: spacing.sm }}>
      {scope.operation === 'encrypt-publish' ? <SigningText>{signingAction({ ...scope, operation: 'publish' }, t)}</SigningText> : null}
      {scope.identifier !== undefined ? <SigningText>{t('napplets.signing_record')}: {scope.identifier || t('napplets.signing_unnamed')}</SigningText> : null}
      {scope.recipient ? <SigningIdentity pubkey={scope.recipient} label={t('napplets.signing_recipient')} /> : null}
      <SigningText variant="caption" tone="muted">{t(scope.operation === 'upload' ? 'napplets.upload_destinations' : 'napplets.signing_destinations')}</SigningText>
      {scope.relays.map((relay) => <SigningText key={relay} variant="caption">{relay}</SigningText>)}
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
  if (request.kind === 30078 && value && typeof value === 'object' && !Array.isArray(value)) {
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
  const auth = request.operation === 'relay-auth';
  const upload = request.operation === 'upload' ? request.upload : undefined;
  const effect = auth ? 'signing_effect_auth' : upload ? 'signing_effect_upload' : request.operation === 'encrypt-publish' ? 'signing_effect_encrypted' : 'signing_effect_publish';
  const showIdentifier = isReplaceableKind(request.kind) || isAddressableKind(request.kind);
  const dTag = request.tags.find((tag) => tag[0] === 'd');
  const title = request.kind === 30023 ? request.tags.find((tag) => tag[0] === 'title')?.[1] : undefined;
  return <View style={{ gap: spacing.lg }}>
    {showTitle ? <SigningText variant="title">{signingAction(request, t)}</SigningText> : null}
    <View style={{ gap: spacing.xs }}>
      <SigningText variant="caption" tone="muted">{t('chat.event_reference.kind', { kind: request.kind })}</SigningText>
      {showIdentifier ? <SigningText variant="caption" tone="muted">
        {`d: ${dTag ? JSON.stringify(dTag[1] ?? '') : t('napplets.none')}`}
      </SigningText> : null}
    </View>
    <SigningText>{t(`napplets.${effect}`)}</SigningText>
    {auth ? <AppCard variant="muted">
      <SigningText variant="subtitle">{new URL(request.relays[0]).host}</SigningText>
    </AppCard> : upload ? <AppCard variant="muted" style={{ gap: spacing.sm }}>
      <SigningText variant="subtitle">{upload.filename || t('message_detail.attachment')}</SigningText>
      <SigningText variant="caption" tone="muted">{upload.mimeType} · {formatFileSize(upload.size)}</SigningText>
      <SigningText variant="caption" tone="muted">{t('napplets.upload_destinations')}</SigningText>
      {request.relays.map((server) => <SigningText key={server}>{new URL(server).host}</SigningText>)}
    </AppCard> : <>
      {request.recipient ? <SigningIdentity pubkey={request.recipient} label={t('napplets.signing_recipient')} /> : null}
      <AppCard variant="muted" style={{ gap: spacing.sm }}>
        {title ? <SigningText variant="subtitle">{title}</SigningText> : null}
        {preview.fields.length ? preview.fields.map(([key, value]) => <View key={key} style={{ flexDirection: 'row', gap: spacing.md }}>
          <SigningText variant="caption" tone="muted" style={{ flex: 1 }}>{key.slice(0, 80)}</SigningText>
          <SigningText style={{ flex: 2 }}>{String(value).slice(0, 140)}</SigningText>
        </View>) : <SigningText>{previewText.slice(0, 600) || t('napplets.none')}</SigningText>}
        {preview.truncated || previewText.length > 600 ? <SigningText variant="caption" tone="muted">{t('napplets.signing_truncated')}</SigningText> : null}
      </AppCard>
    </>}
    <View style={{ alignSelf: 'center' }}>
      <AppButton variant="text" label={t(details ? 'napplets.signing_hide_details' : 'napplets.signing_details')}
        accessibilityState={{ expanded: details }}
        iconRight={details ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />}
        onPress={() => setDetails(!details)} />
    </View>
    {details ? <View style={{ gap: spacing.lg }}>
      <EventJson request={request} />
      <View style={{ gap: spacing.sm }}>
        <SigningText variant="caption" tone="muted">{t('napplets.signing_destinations')}</SigningText>
        {request.relays.map((relay) => <SigningText key={relay} variant="caption">{relay}</SigningText>)}
      </View>
    </View> : null}
  </View>;
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
