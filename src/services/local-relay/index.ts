import { platform } from '@/platform';
import { verifyEventNativeFirst } from '@/services/relay/relay-pool';
import { LocalRelay } from './relay';

/** One device-wide cache; account-bound relay AUTH stays in each runtime's network pool. */
export const localRelay = new LocalRelay(platform.database, event => verifyEventNativeFirst(event, 'local'));
