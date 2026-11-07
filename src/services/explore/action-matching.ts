import type { ExploreEntry } from './model';

export type ApplicationActionFilter = { name: string; auxiliary: boolean };
/** Runtime callbacks may handle explicitly declared event kinds through generic view. */
export const matchesAction = (pattern: string, name: string) => pattern === name || pattern === 'view' && name.startsWith('view:');

export function supportsApplicationAction(app: ExploreEntry, filter: ApplicationActionFilter): boolean {
  return app.kind === 'napp' && !!app.manifest?.tags.some(tag => tag[0] === 'mode' && tag[1] === 'auxiliary') === filter.auxiliary &&
    !!(app.local?.actions.includes(filter.name) ||
      app.manifest?.tags.some(tag => tag[0] === 'action' && tag[1] === filter.name));
}
