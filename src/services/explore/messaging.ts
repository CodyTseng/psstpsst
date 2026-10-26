import { platform } from '@/platform';
import type { ApplicationMessagingPort } from '@/platform/ports/application-messaging';
import { ApplicationMessagingBroker } from './messaging-broker';

const broker = new ApplicationMessagingBroker();
const listeners = new Set<Parameters<ApplicationMessagingPort['onMessage']>[0]>();
const local: ApplicationMessagingPort = {
  async connect(endpoint) { broker.connect(endpoint, message => { for (const listener of listeners) listener(endpoint.instance, message); }); },
  async disconnect(instance) { broker.disconnect(instance); },
  async request(instance, message) { return broker.request(instance, message); },
  onMessage(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export function applicationMessaging(): ApplicationMessagingPort {
  const windows = platform.napplet.windows;
  if (windows && !windows.messaging) throw new Error('napplets.rebuild_required');
  return windows?.messaging ?? local;
}
