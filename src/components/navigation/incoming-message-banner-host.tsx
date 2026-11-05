import { Navigator, router } from 'expo-router';

import { IncomingMessageBanner } from '@/components/chat/IncomingMessageBanner';
import { incomingMessageVisibility } from '@/components/navigation/incoming-message-visibility';
import { PRIMARY_PANE_RESET_MARKER } from '@/components/navigation/responsive-stack-router';
import { useQuietMessageRequests } from '@/hooks/use-quiet-message-requests';
import { useActiveAccount } from '@/stores/active-account.store';
import { useUnreadIndicatorPreference } from '@/stores/unread-count.store';

export function IncomingMessageBannerHost({ wide }: { wide: boolean }) {
  const { state } = Navigator.useContext();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const indicators = useUnreadIndicatorPreference();
  const requestPreference = useQuietMessageRequests();
  const { chatsVisible, activeConversationKey } = incomingMessageVisibility(state, wide);

  if (!accountPubkey) return null;

  return (
    <IncomingMessageBanner
      key={accountPubkey}
      accountPubkey={accountPubkey}
      activeConversationKey={activeConversationKey}
      enabled={indicators.enabled && indicators.resolved}
      ready={indicators.resolved && requestPreference.resolved}
      chatsVisible={chatsVisible}
      quietRequests={!requestPreference.resolved || requestPreference.quiet}
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
