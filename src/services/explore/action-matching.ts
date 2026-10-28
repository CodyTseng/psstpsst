import type { ExploreEntry } from './model';

export type ApplicationActionFilter = { name: string; auxiliary: boolean };
export const matchesAction = (pattern: string, name: string) => pattern === name || pattern === 'view' && name.startsWith('view:');

export function supportsApplicationAction(app: ExploreEntry, filter: ApplicationActionFilter): boolean {
  return app.kind === 'napp' && !!app.manifest?.tags.some(tag => tag[0] === 'mode' && tag[1] === 'auxiliary') === filter.auxiliary &&
    !!(app.local?.actions.some(pattern => matchesAction(pattern, filter.name)) ||
      app.manifest?.tags.some(tag => tag[0] === 'action' && matchesAction(tag[1], filter.name)));
}
