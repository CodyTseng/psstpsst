import { desktopApps, moveDesktopApp, recentApps } from '../desktop-order';
import type { NappletInstallation } from '../protocol';

it('keeps explicit positions independent of last use and excludes unsaved apps', () => {
  const apps = [
    { eventKey: 'a', desktopPosition: 1, lastUsedAt: 999 },
    { eventKey: 'b', desktopPosition: 0, lastUsedAt: 1 },
    { eventKey: 'c', desktopPosition: null, lastUsedAt: 1000 },
  ] as NappletInstallation[];
  expect(desktopApps(apps).map((app) => app.eventKey)).toEqual(['b', 'a']);
  expect(apps[0].eventKey).toBe('a');
});

it('inserts, moves and removes exactly one shortcut without changing its input', () => {
  const keys = ['a', 'b', 'c'];
  expect(moveDesktopApp(keys, 'c', 0)).toEqual(['c', 'a', 'b']);
  expect(moveDesktopApp(keys, 'a', 2)).toEqual(['b', 'c', 'a']);
  expect(moveDesktopApp(keys, 'new', 1)).toEqual(['a', 'new', 'b', 'c']);
  expect(moveDesktopApp(keys, 'b', null)).toEqual(['a', 'c']);
  expect(moveDesktopApp(keys, 'b', 512)).toEqual(['a', 'c', 'b']);
  expect(() => moveDesktopApp(keys, 'b', NaN)).toThrow('invalid-desktop-position');
  expect(keys).toEqual(['a', 'b', 'c']);
});


it('offers all used installations beyond the 24-app preview in recency order', () => {
  const installed = Array.from({ length: 40 }, (_, index) => ({
    eventKey: `app-${index}`, lastUsedAt: index, desktopPosition: null,
  })) as NappletInstallation[];
  const unused = { eventKey: 'unused', lastUsedAt: null } as NappletInstallation;
  const recent = recentApps([...installed, unused]);
  expect(recent).toHaveLength(40);
  expect(recent[0].eventKey).toBe('app-39');
  expect(recent.at(-1)?.eventKey).toBe('app-0');
  expect(installed[0].eventKey).toBe('app-0');
});
