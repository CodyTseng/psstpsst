import { and, eq } from 'drizzle-orm';
import { useMemo } from 'react';

import { db } from '@/db/client';
import { replaceableEvents } from '@/db/schema';
import { useLiveQuery } from '@/db/use-live-query';
import { capDeliveryRelays } from '@/services/relay/relay-router';
import { normalizeRelayUrls } from '@/lib/nostr/relay-url';
import { availableCommands, COMMAND_KIND, type CommandContext } from '@/lib/nostr/commands';

/** Cache-only subscriptions: discovery follows profile loading, never typing. */
export function useCommands(peer: string | undefined, context: CommandContext | undefined, enabled: boolean) {
  const { data: definitions } = useLiveQuery(db.select().from(replaceableEvents).where(and(
    eq(replaceableEvents.pubkey, peer ?? ''), eq(replaceableEvents.kind, COMMAND_KIND),
  )), [peer, enabled], { enabled: enabled && !!peer });
  const { data: inboxRows } = useLiveQuery(db.select().from(replaceableEvents).where(and(
    eq(replaceableEvents.pubkey, peer ?? ''), eq(replaceableEvents.kind, 10050), eq(replaceableEvents.dTag, ''),
  )).limit(1), [peer, enabled], { enabled: enabled && !!peer });
  const inbox = inboxRows?.[0];
  const relays = useMemo(() => inbox?.pubkey === peer && inbox.event
    ? capDeliveryRelays(normalizeRelayUrls(inbox.event.tags.filter(tag => tag[0] === 'relay').map(tag => tag[1]))) : [], [inbox, peer]);
  return useMemo(() => enabled && context ? availableCommands((definitions ?? []).flatMap(row =>
    row.pubkey === peer && row.kind === COMMAND_KIND && row.event?.pubkey === peer ? [row.event] : [],
  ), { ...context, relays }) : [], [context, enabled, peer, relays, definitions]);
}
