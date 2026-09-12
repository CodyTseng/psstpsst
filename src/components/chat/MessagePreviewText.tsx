import { Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { useDisplayName } from '@/hooks/use-display-name';
import { splitCustomEmojiText } from '@/lib/emoji/custom-message';
import { customEmojisFromMessageTags } from '@/lib/nostr/custom-emoji';
import {
  parseMessageSegments,
  soleEventReference,
  soleMentionPubkey,
} from '@/lib/text/message-segments';
import { parseInvoiceMessage } from '@/lib/wallet/invoice-message';
import { formatSats } from '@/services/wallet/bolt11';

function MentionName({ pubkey }: { pubkey: string }) {
  const { name } = useDisplayName(pubkey);
  return <Text>@{name}</Text>;
}

function ContactCardPreview({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation();
  const { name } = useDisplayName(pubkey);
  // A whole-message mention renders as a name card in the thread (DESIGN §8),
  // so its preview reads like an attachment label: "[Contact card] Alice".
  return <>{t('conversations.contact_card_preview', { name })}</>;
}

/**
 * Render a message body for a one-line conversation preview:
 * authenticated custom-emoji shortcodes use a localized bracketed Sticker
 * label and their bare shortcode; otherwise
 * a whole-message `nostr:` mention shows as "[Contact card] name"; inline
 * mentions become the user's `@name`; event references become "[Shared event]";
 * URLs and other text show as-is. Most previews have no special token, so the
 * ordinary path remains a single truncated `AppText`.
 */
export function MessagePreviewText({
  content,
  tags,
  invoiceRole = 'received',
}: {
  content: string;
  tags?: string[][] | null;
  invoiceRole?: 'sent' | 'received';
}) {
  const { t } = useTranslation();
  const customEmojiMap = useMemo(() => {
    if (!content.includes(':') || !tags) return null;
    const tagged = customEmojisFromMessageTags(tags);
    if (tagged.length === 0) return null;
    return new Map(tagged.map((emoji) => [emoji.shortcode.toLowerCase(), emoji] as const));
  }, [content, tags]);
  const cardPubkey = useMemo(() => soleMentionPubkey(content), [content]);
  const eventReference = useMemo(() => soleEventReference(content), [content]);
  const invoice = useMemo(() => parseInvoiceMessage(content), [content]);
  const segments = useMemo(() => parseMessageSegments(content), [content]);
  const customPreviewParts = useMemo(() => {
    if (!customEmojiMap) return null;
    const parts: (
      | { type: 'text'; value: string }
      | { type: 'mention'; pubkey: string }
      | { type: 'event' }
      | { type: 'sticker'; shortcode: string }
    )[] = [];
    let foundEmoji = false;
    for (const segment of segments) {
      if (segment.type === 'mention') {
        parts.push({ type: 'mention', pubkey: segment.pubkey });
      } else if (segment.type === 'event') {
        parts.push({ type: 'event' });
      } else if (segment.type === 'url') {
        parts.push({ type: 'text', value: segment.value });
      } else {
        for (const part of splitCustomEmojiText(segment.value, customEmojiMap)) {
          if (part.type === 'emoji') foundEmoji = true;
          parts.push(
            part.type === 'emoji'
              ? { type: 'sticker', shortcode: part.emoji.shortcode }
              : part,
          );
        }
      }
    }
    return foundEmoji ? parts : null;
  }, [customEmojiMap, segments]);

  let preview: ReactNode;
  if (customPreviewParts) {
    const stickerOnly = customPreviewParts.every(
      (part) => part.type === 'sticker' || (part.type === 'text' && part.value.trim() === ''),
    );
    if (stickerOnly) {
      const separator = t('conversations.sticker_preview_separator');
      const shortcodes = customPreviewParts
        .flatMap((part) => (part.type === 'sticker' ? [part.shortcode] : []))
        .join(separator);
      preview = t('conversations.sticker_preview', { shortcodes });
    } else {
      preview = customPreviewParts.map((part, index) =>
        part.type === 'mention' ? (
          <MentionName key={index} pubkey={part.pubkey} />
        ) : part.type === 'event' ? (
          <Fragment key={index}>{t('conversations.event_reference_preview')}</Fragment>
        ) : part.type === 'sticker' ? (
          <Fragment key={index}>
            {t('conversations.sticker_preview', { shortcodes: part.shortcode })}
          </Fragment>
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        ),
      );
    }
  } else if (cardPubkey) {
    preview = <ContactCardPreview pubkey={cardPubkey} />;
  } else if (eventReference) {
    preview = t('conversations.event_reference_preview');
  } else if (invoice) {
    preview = t('conversations.invoice_preview', {
      context: invoiceRole,
      amount: formatSats(invoice.amountMsat, t('wallet.sats_unit'), t('wallet.unknown')),
    });
  } else if (segments.length === 1 && segments[0].type === 'text') {
    preview = content;
  } else {
    preview = segments.map((seg, i) =>
      seg.type === 'mention' ? (
        <MentionName key={i} pubkey={seg.pubkey} />
      ) : seg.type === 'event' ? (
        <Fragment key={i}>{t('conversations.event_reference_preview')}</Fragment>
      ) : (
        <Fragment key={i}>{seg.value}</Fragment>
      ),
    );
  }

  return (
    <AppText variant="body" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
      {preview}
    </AppText>
  );
}
