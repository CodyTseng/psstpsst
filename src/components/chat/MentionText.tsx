import { router } from 'expo-router';
import { Text } from 'react-native';

import { useDisplayName } from '@/hooks/use-display-name';
import { IS_ELECTRON } from '@/lib/platform';

type Props = {
  /** Hex pubkey the `nostr:` mention decoded to. */
  pubkey: string;
  /** Colour to paint the mention, matching its bubble (links share this). */
  color: string;
};

/**
 * An inline `nostr:` mention rendered as the user's display name, prefixed with
 * `@`, underlined, and tappable to open their profile. A nested `<Text>` so it
 * flows inside the message body's `AppText`. Name resolution is shared with the
 * name card via `useDisplayName`, so list bubble and lifted long-press copy match.
 */
export function MentionText({ pubkey, color }: Props) {
  const { name } = useDisplayName(pubkey);
  return (
    <Text
      selectable={IS_ELECTRON}
      onPress={() => router.push(`/profile/${encodeURIComponent(pubkey)}`)}
      style={{ color, textDecorationLine: 'underline' }}
    >
      @{name}
    </Text>
  );
}
