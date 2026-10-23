import { nappletAdapter, nativeSurface } from '../expo/napplet';
import { pageAppearance } from '@/lib/page-appearance';

jest.mock('expo-modules-core', () => ({ ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => ({ isAvailable: () => true, isExploreAvailable: () => true, closeAsync: async () => {} }) }));
jest.mock('../expo/application-tasks', () => ({ applicationTasksAdapter: {} }));

it('validates colors and selects contrasting status text for light and dark documents', () => {
  expect(pageAppearance('#FFFFFF')).toEqual({ background: '#ffffff', dark: false });
  expect(pageAppearance('#121212')).toEqual({ background: '#121212', dark: true });
  expect(pageAppearance('red')).toBeUndefined();
  expect(pageAppearance('#ffffff00')).toBeUndefined();
  expect(pageAppearance({ background: '#ffffff' })).toBeUndefined();
});

it('resets colors on navigation and ignores hints from the previous document', async () => {
  const id = await nappletAdapter.openPage!({ sourceId: 'https://example.com', url: 'https://example.com', script: '', network: true });
  const navigation = (document: string) => nativeSurface.message(id, JSON.stringify({ type: 'explore.navigation', document }));
  const hint = (document: string, color: string) => nativeSurface.message(id, JSON.stringify({ type: 'explore.request', document,
    raw: JSON.stringify({ type: 'psst.appearance', color }) }));
  try {
    navigation('first'); hint('first', '#ffffff');
    expect(nativeSurface.get(id)?.appearance?.background).toBe('#ffffff');
    navigation('second');
    expect(nativeSurface.get(id)?.appearance).toBeUndefined();
    hint('first', '#123456');
    expect(nativeSurface.get(id)?.appearance).toBeUndefined();
    hint('second', '#121212');
    expect(nativeSurface.get(id)?.appearance?.dark).toBe(true);
  } finally { await nappletAdapter.close(id); }
});

it('keeps presentation local to the live surface and deduplicates updates', async () => {
  const id = await nappletAdapter.open('<main>Application</main>');
  const changed = jest.fn(), protocol = jest.fn();
  const unsubscribe = nativeSurface.subscribe(changed);
  const removeListener = nappletAdapter.addMessageListener(protocol);
  try {
    const hint = JSON.stringify({ type: 'psst.appearance', color: '#123456' });
    nativeSurface.message(id, hint);
    nativeSurface.message(id, hint);
    expect(nativeSurface.get(id)?.appearance).toEqual(pageAppearance('#123456'));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(protocol).not.toHaveBeenCalled();
    nativeSurface.message(id, JSON.stringify({ type: 'psst.appearance', color: null }));
    expect(nativeSurface.get(id)?.appearance).toBeUndefined();
    nativeSurface.message('closed-surface', hint);
    expect(changed).toHaveBeenCalledTimes(2);
  } finally { unsubscribe(); removeListener(); await nappletAdapter.close(id); }
});
