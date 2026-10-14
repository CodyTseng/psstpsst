import { Navigator, router } from 'expo-router';

import { IncomingMessageBanner } from '@/components/chat/IncomingMessageBanner';
import { incomingMessageVisibility } from '@/components/navigation/incoming-message-visibility';
import { PRIMARY_PANE_RESET_MARKER } from '@/components/navigation/responsive-stack-router';
import { useActiveAccount } from '@/stores/active-account.store';
import { useUnreadIndicatorsEnabled } from '@/stores/unread-count.store';

export function IncomingMessageBannerHost({ wide }: { wide: boolean }) {
  const { state } = Navigator.useContext();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const enabled = useUnreadIndicatorsEnabled();
  const { chatsVisible, activeConversationKey } = incomingMessageVisibility(state, wide);

  if (!accountPubkey) return null;

  return (
    <IncomingMessageBanner
      key={accountPubkey}
      accountPubkey={accountPubkey}
      activeConversationKey={activeConversationKey}
      enabled={enabled && !chatsVisible}
      onOpen={(href) => {
        if (wide) {
          router.push(href, { dangerouslySingular: PRIMARY_PANE_RESET_MARKER });
        } else if (activeConversationKey) {
          router.replace(href);
        } else {
          router.push(href);
        }
      }}
    />
  );
}
