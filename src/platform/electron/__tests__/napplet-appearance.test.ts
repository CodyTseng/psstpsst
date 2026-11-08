import { electronPageAppearance } from '../napplet-appearance';
import { electronNappletAdapter } from '../napplet';
import type { ElectronBridge } from '../bridge';

const hint = (color: unknown, document?: string) => JSON.stringify({ type: 'psst.appearance', color, document });
const navigation = (document: string) => JSON.stringify({ type: 'explore.navigation', document });
afterEach(() => { electronPageAppearance.close('app'); electronPageAppearance.close('other'); delete window.psstpsstDesktop; });

it('caches early hints, deduplicates colors and rejects hints from a replaced document', () => {
  const changed = jest.fn(), unsubscribe = electronPageAppearance.subscribe(changed);
  try {
    electronPageAppearance.message('app', navigation('one'));
    expect(electronPageAppearance.message('app', hint('#121212', 'one'))).toBe(true);
    const first = electronPageAppearance.get('app');
    expect(first).toEqual({ background: '#121212', dark: true });
    electronPageAppearance.message('app', hint('#121212', 'one'));
    expect(electronPageAppearance.get('app')).toBe(first);
    expect(changed).toHaveBeenCalledTimes(1);
    electronPageAppearance.message('app', navigation('two'));
    expect(electronPageAppearance.get('app')).toBeUndefined();
    electronPageAppearance.message('app', hint('#ffffff', 'one'));
    expect(electronPageAppearance.get('app')).toBeUndefined();
    electronPageAppearance.message('app', hint('#ffffff', 'two'));
    expect(electronPageAppearance.get('app')).toEqual({ background: '#ffffff', dark: false });
    electronPageAppearance.message('app', hint('transparent', 'two'));
    expect(electronPageAppearance.get('app')).toBeUndefined();
    expect(electronPageAppearance.get('other')).toBeUndefined();
  } finally { unsubscribe(); }
});

it('keeps appearance messages out of the application protocol and clears them on close', async () => {
  let receive!: (id: string, raw: string) => void;
  const unsubscribe = jest.fn(), protocol = jest.fn(), close = jest.fn(async () => {});
  window.psstpsstDesktop = { napplet: { close, onMessage: (callback: (id: string, raw: string) => void) => { receive = callback; return unsubscribe; } } } as unknown as ElectronBridge;
  const stop = electronNappletAdapter.addMessageListener(protocol);
  receive('app', hint('#facc15'));
  expect(electronPageAppearance.get('app')).toEqual({ background: '#facc15', dark: false });
  expect(protocol).not.toHaveBeenCalled();
  receive('app', '{"type":"shell.ready"}');
  expect(protocol).toHaveBeenCalledWith('app', '{"type":"shell.ready"}');
  await electronNappletAdapter.close('app');
  expect(electronPageAppearance.get('app')).toBeUndefined();
  expect(close).toHaveBeenCalledWith('app');
  stop();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
