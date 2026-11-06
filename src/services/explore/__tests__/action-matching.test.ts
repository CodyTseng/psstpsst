import { matchesAction, supportsApplicationAction } from '../action-matching';
import type { ExploreEntry } from '../model';

const app = (actions: string[], auxiliary = false): ExploreEntry => ({
  key: 'app', address: 'app', title: 'App', description: '', kind: 'napp', servers: [], required: [],
  desktopPosition: null, lastUsedAt: null,
  manifest: { id: 'event', pubkey: 'author', sig: '', kind: 35130, created_at: 0, content: '',
    tags: [...actions.map(name => ['action', name]), ...(auxiliary ? [['mode', 'auxiliary']] : [])] },
});

it('offers specific and generic declarations for a specific event kind', () => {
  const request = { name: 'view:30023', auxiliary: false };
  expect(supportsApplicationAction(app(['view']), request)).toBe(true);
  expect(supportsApplicationAction(app(['view:1']), request)).toBe(false);
  expect(supportsApplicationAction(app(['view:30023']), request)).toBe(true);
  expect(supportsApplicationAction(app(['view', 'view:30023']), request)).toBe(true);
});

it('keeps unresolved generic views separate from specific declarations', () => {
  expect(supportsApplicationAction(app(['view']), { name: 'view', auxiliary: false })).toBe(true);
  expect(supportsApplicationAction(app(['view:30023']), { name: 'view', auxiliary: false })).toBe(false);
  expect(matchesAction('view', 'view:30023')).toBe(true);
  expect(matchesAction('view:30023', 'view:1')).toBe(false);
});

it('includes local generic viewers and preserves mode filtering', () => {
  const local = { ...app([]), local: { version: 'v1', installer: 'builder', actions: ['view'] } };
  expect(supportsApplicationAction(local, { name: 'view:30023', auxiliary: false })).toBe(true);
  expect(supportsApplicationAction({ ...local, local: { ...local.local, actions: ['view:30023'] } },
    { name: 'view:30023', auxiliary: false })).toBe(true);
  expect(supportsApplicationAction(app(['view:30023'], true), { name: 'view:30023', auxiliary: false })).toBe(false);
  expect(supportsApplicationAction(app(['view:30023'], true), { name: 'view:30023', auxiliary: true })).toBe(true);
});

it('does not conflate profile and view:0', () => {
  expect(supportsApplicationAction(app(['profile']), { name: 'view:0', auxiliary: false })).toBe(false);
  expect(supportsApplicationAction(app(['view:0', 'view']), { name: 'profile', auxiliary: false })).toBe(false);
});
