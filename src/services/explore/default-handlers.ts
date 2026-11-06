import { dataEntries, getData, setData } from '@/services/napplet/data-repository';
import { assertNotAborted } from '@/platform/abort';
import { applicationEntryFromAddress, resolveApplicationReference } from './application-reference';
import { getDiscoveryStore } from './discovery';
import { readApplicationHandlers } from './application-handlers';
import { supportsApplicationAction, type ApplicationActionFilter } from './action-matching';
import type { ExploreEntry } from './model';

export type HandlerType = { kind: 'action'; name: string; auxiliary: boolean } | { kind: 'intent'; name: string };
export type DefaultHandler = { type: HandlerType; sourceId: string; title: string; address?: string };
const scope = (account: string, kind: HandlerType['kind']) => ({ accountPubkey: account, appKey: `host:${kind === 'action' ? 'action' : 'intent'}-defaults` });
const key = (type: HandlerType) => type.kind === 'action' ? JSON.stringify([type.name, type.auxiliary]) : type.name;

function decode(type: HandlerType, value: string): DefaultHandler | null {
  if (type.kind === 'intent') return { type, sourceId: value, title: '' };
  try {
    const record = JSON.parse(value);
    return typeof record.sourceId === 'string' && typeof record.title === 'string' && typeof record.address === 'string'
      ? { type, sourceId: record.sourceId, title: record.title, address: record.address } : null;
  } catch { return null; }
}

/** Indexed account-scoped reads keep dispatch independent of history size. */
export async function readDefaultActionHandler(account: string, action: ApplicationActionFilter): Promise<DefaultHandler | null> {
  const type = { kind: 'action' as const, ...action };
  const value = await getData(scope(account, 'action'), 'defaults', key(type));
  return value ? decode(type, value) : null;
}

export async function setDefaultHandler(account: string, type: HandlerType, app: ExploreEntry | null): Promise<void> {
  if (app && type.kind === 'intent' && !matchesHandlerType(app, type)) throw new Error('handler-unavailable');
  await setData(scope(account, type.kind), 'defaults', key(type), app === null ? null : type.kind === 'intent'
    ? app.release!.eventKey : JSON.stringify({ sourceId: app.key, title: app.title, address: app.address }));
}

export function matchesHandlerType(app: ExploreEntry, type: HandlerType): boolean {
  return type.kind === 'action' ? supportsApplicationAction(app, type)
    : !!app.release?.intents.some(contract => contract.convention === type.name);
}

export async function readDefaultHandlers(account: string): Promise<DefaultHandler[]> {
  const [actions, intents] = await Promise.all([
    dataEntries(scope(account, 'action'), 'defaults'), dataEntries(scope(account, 'intent'), 'defaults'),
  ]);
  const result: DefaultHandler[] = [];
  for (const [encoded, value] of actions) {
    try {
      const [name, auxiliary] = JSON.parse(encoded);
      if (typeof name !== 'string' || typeof auxiliary !== 'boolean') continue;
      const record = decode({ kind: 'action', name, auxiliary }, value);
      if (record) result.push(record);
    } catch { /* Ignore malformed preferences without blocking settings. */ }
  }
  if (intents.size) {
    const apps = await readApplicationHandlers(account, 'napplet');
    const titles = new Map(apps.map(app => [app.release?.eventKey, app.title]));
    for (const [name, sourceId] of intents) result.push({ type: { kind: 'intent', name }, sourceId,
      title: titles.get(sourceId) ?? '' });
  }
  return result.sort((a, b) => key(a.type).localeCompare(key(b.type)));
}

export async function readHandlerCandidates(account: string, type: HandlerType): Promise<ExploreEntry[]> {
  return (await readApplicationHandlers(account, type.kind === 'action' ? 'napp' : 'napplet')).filter(app => matchesHandlerType(app, type));
}

/** Catalogue defaults retain the same verified action/mode checks as one-time handoffs. */
export function findCatalogueHandler(type: HandlerType, sourceId: string): ExploreEntry | undefined {
  if (type.kind !== 'action') return;
  return getDiscoveryStore('napps').getState().entries.find(app => app.key === sourceId && matchesHandlerType(app, type));
}

/** Reopening settings always includes the current compatible default, even without library membership. */
export async function readDefaultHandlerCandidates(account: string, preference: DefaultHandler, signal: AbortSignal): Promise<ExploreEntry[]> {
  const apps = await readHandlerCandidates(account, preference.type);
  assertNotAborted(signal);
  let current = apps.find(app => (preference.type.kind === 'intent' ? app.release?.eventKey : app.key) === preference.sourceId)
    ?? findCatalogueHandler(preference.type, preference.sourceId);
  if (!current && preference.type.kind === 'action' && preference.address) {
    const reference = applicationEntryFromAddress(preference.address);
    if (reference) current = await resolveApplicationReference(account, reference, signal) ?? undefined;
    assertNotAborted(signal);
  }
  if (!current || current.key !== preference.sourceId || !matchesHandlerType(current, preference.type)) return apps;
  return [current, ...apps.filter(app => app.key !== current.key)];
}
