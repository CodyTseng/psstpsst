import { isMessageOrderNewer, type MessageOrderKey } from '@/lib/nostr/message-order';

export type MembershipActionRecord = MessageOrderKey & {
  authorPubkey: string;
  memberPubkey: string;
  action: 'invite' | 'remove';
  everApplied: boolean;
};

export type MembershipReplayEntry = MembershipActionRecord & {
  applied: boolean;
  firstApplication: boolean;
};

export type MembershipReplayResult = {
  members: string[];
  actions: MembershipReplayEntry[];
  tail: MessageOrderKey | null;
};

/** Oldest-to-newest under the shared Nostr tie-break. */
export function compareMembershipActionOrder(
  a: MessageOrderKey,
  b: MessageOrderKey,
): number {
  if (a.orderAt !== b.orderAt) return a.orderAt - b.orderAt;
  return b.id.localeCompare(a.id);
}

export function replayMembershipActions(
  bootstrapMembers: readonly string[],
  bootstrapCursor: MessageOrderKey,
  actions: readonly MembershipActionRecord[],
): MembershipReplayResult {
  const members = new Set(bootstrapMembers);
  const ordered = [...actions].sort(compareMembershipActionOrder);
  const replayed: MembershipReplayEntry[] = [];
  let tail: MessageOrderKey | null = null;

  for (const action of ordered) {
    if (!isMessageOrderNewer(action, bootstrapCursor)) {
      replayed.push({ ...action, applied: false, firstApplication: false });
      continue;
    }
    const applied = members.has(action.authorPubkey);
    if (applied) {
      if (action.action === 'invite') members.add(action.memberPubkey);
      else members.delete(action.memberPubkey);
    }
    replayed.push({
      ...action,
      applied,
      firstApplication: applied && !action.everApplied,
    });
    tail = { orderAt: action.orderAt, id: action.id };
  }

  return {
    members: [...members].sort(),
    actions: replayed,
    tail,
  };
}
