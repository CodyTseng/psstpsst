import { pageAppearance, type PageAppearance } from '@/lib/page-appearance';

const documents = new Map<string, { document?: string; appearance?: PageAppearance }>();
const listeners = new Set<() => void>();

/** Cache presentation hints before the runtime's asynchronous open has returned. */
export const electronPageAppearance = {
  get: (id: string) => documents.get(id)?.appearance,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  message(id: string, raw: string): boolean {
    // Do not parse large application requests merely to inspect presentation hints.
    if (!raw.startsWith('{"type":"psst.appearance"') && !raw.startsWith('{"type":"explore.navigation"')) return false;
    try {
      const message = JSON.parse(raw), previous = documents.get(id);
      if (message.type === 'psst.appearance' && previous?.document && message.document !== previous.document) return true;
      const appearance = message.type === 'psst.appearance' ? pageAppearance(message.color) : undefined;
      const changed = previous?.appearance?.background !== appearance?.background;
      documents.set(id, { document: message.type === 'explore.navigation' ? message.document : previous?.document,
        appearance: changed ? appearance : previous?.appearance });
      if (changed) listeners.forEach(listener => listener());
      return message.type === 'psst.appearance';
    } catch { return false; }
  },
  close(id: string) {
    if (documents.delete(id)) listeners.forEach(listener => listener());
  },
};
