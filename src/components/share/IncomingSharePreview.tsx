import dayjs from "dayjs";
import { useMemo } from "react";
import { View } from "react-native";

import { MessageBubble } from "@/components/chat/MessageBubble";
import { PendingAttachmentBubble } from "@/components/chat/PendingAttachmentBubble";
import type { ReactionAggregate } from "@/lib/nostr/reactions";
import type { IncomingShareItem } from "@/lib/share/incoming-share";
import type { PendingAttachment } from "@/stores/pending-attachments.store";

const NO_REACTIONS: ReactionAggregate[] = [];
const noop = () => {};

/** Preview payloads received from the OS using the app's real outgoing bubbles. */
export function IncomingSharePreview({
  items,
}: {
  items: IncomingShareItem[];
}) {
  const now = useMemo(() => dayjs().unix(), []);

  return (
    <View style={{ pointerEvents: 'none' }}>
      {items.map((item, index) => {
        if (item.kind === "text") {
          return (
            <MessageBubble
              key={item.id}
              content={item.content}
              tags={[]}
              isSelf
              createdAt={now}
              orderAt={now * 1000 + index}
              reactions={NO_REACTIONS}
              groupStart={index === 0}
              rowBackground="transparent"
              onTapReaction={noop}
            />
          );
        }

        const pending: PendingAttachment = {
          accountPubkey: "",
          conversationKey: "",
          tempId: item.id,
          localUri: item.localUri,
          mime: item.mime,
          name: item.name,
          size: item.size,
          status: "sent",
          startedAt: now + index,
        };
        return (
          <PendingAttachmentBubble
            key={item.id}
            pending={pending}
            onStop={noop}
            onRetry={noop}
            onCancel={noop}
            groupStart={index === 0}
            rowBackground="transparent"
          />
        );
      })}
    </View>
  );
}
