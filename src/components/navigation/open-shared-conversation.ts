import { router } from 'expo-router';

import { shareTargetHref, type ShareTarget } from '@/lib/share/share-target';

import { PRIMARY_PANE_RESET_MARKER } from './responsive-stack-router';

/** Build [primary, destination] atomically so Back never enters an old chat. */
export function openSharedConversation(target: ShareTarget): void {
  router.push(shareTargetHref(target), { dangerouslySingular: PRIMARY_PANE_RESET_MARKER });
}

