import { resolveFavoriteMetadata } from './favorite-metadata';
import { createStore } from 'zustand/vanilla';
import { platform } from '@/platform';
import { assertNotAborted } from '@/platform/abort';
import { canReceiveForAccount } from '@/services/account/account-receive-guard';
import { nappletService, nappletStore } from '@/services/napplet/service';
import { registerNappletLifecycle, registerNappletTheme, registerNappletSourceInvalidation } from '@/services/napplet/lifecycle';
import { NappletRuntime, type RuntimePrompt, type RuntimeTheme } from '@/services/napplet/runtime';
import { loadArtifact } from '@/services/napplet/artifacts';
import { NAP_DOMAINS, randomId } from '@/services/napplet/protocol';
import { getData, setData } from '@/services/napplet/repository';
import { readDomainPermissions, resolveDomainPermissions } from '@/services/napplet/domain-permissions';
import { ExploreRuntime } from './runtime';
import { applicationPresentation, applicationRequirements, applicationSigningSource, SUPPORTED_NAPP_DOMAINS, fromNapplet, websiteEntry, type ExploreEntry } from './model';
import { visit } from './repository';
import { readApplicationHandlers } from './application-handlers';
import { applicationPresence } from './application-presence';
import { applicationSourceId } from '@/lib/application-identity';
import { shouldOpenApplicationWindow } from './open-preferences';
import { openInlineApplication } from './inline-launch';

export type ApplicationTaskState = {
  entry: ExploreEntry; account: string; containerId?: string; loading: boolean; error?: string;
};
type Session = {
  account: string; sourceId: string;
  aliases: Set<string>;
  opened?: Promise<void>;
  life: AbortController; reviewed?: readonly string[]; starting?: Promise<void>; cleanup?: Promise<void>;
  runtime?: ExploreRuntime | NappletRuntime; delivery?: Record<string, unknown>;
};
export const applicationTaskStore = createStore(() => ({ sessions: new Map<string, ApplicationTaskState>() }));
const sessions = new Map<string, Session>();
let subscribed = false;
function rememberAlias(session: Session, alias: string) {
  session.aliases.delete(alias);
  session.aliases.add(alias);
  while (session.aliases.size > 512) session.aliases.delete(session.aliases.values().next().value!);
}
const patch = (id: string, update: Partial<ApplicationTaskState>) => applicationTaskStore.setState(state => {
  const current = state.sessions.get(id);
  if (!current) return state;
  const next = new Map(state.sessions); next.set(id, { ...current, ...update });
  return { sessions: next };
});
const theme = (): RuntimeTheme => {
  const value = nappletService.currentTheme();
  if (!value) throw new Error('application-not-ready');
  return value;
};

/** All task runtimes share the trusted process; each owns its WebView and cancellation scope. */
export const applicationTasks = {
  async open(entry: ExploreEntry, account: string, reviewed?: readonly string[], delivery?: Record<string, unknown>): Promise<void> {
    const tasks = platform.napplet.tasks;
    if (!tasks) throw new Error('applications.rebuild_required');
    if (!await canReceiveForAccount(account)) throw new Error('account-unavailable');
    if (nappletStore.getState().accountPubkey !== account) throw new Error('session-closed');
    const sourceId = applicationSourceId(entry.address);
    for (const [id, session] of sessions) if (session.account === account && (session.sourceId === sourceId || session.aliases.has(sourceId))) {
      try {
        await session.opened;
        if (sessions.get(id) !== session) return this.open(entry, account, reviewed, delivery);
        await tasks.focus(id);
        if (delivery) { session.delivery = delivery; if (session.runtime instanceof NappletRuntime) session.runtime.setDelivery(delivery); }
        return;
      } catch { await this.close(id); }
    }
    if (sessions.size >= 16) throw new Error('quota-exceeded');
    if (!subscribed) {
      tasks.onClosed(id => { void this.close(id, false).catch(error => console.warn('[explore] Task cleanup failed', error)); });
      subscribed = true;
    }
    const id = randomId();
    const session: Session = { account, sourceId, aliases: new Set(), life: new AbortController(), reviewed: reviewed ? [...reviewed] : undefined, delivery };
    sessions.set(id, session);
    applicationPresence.set(account, sourceId, true);
    applicationTaskStore.setState(state => ({ sessions: new Map(state.sessions).set(id, { entry, account, loading: true }) }));
    session.opened = tasks.open(id, entry.title.slice(0, 200));
    try { await session.opened; }
    catch (error) { await this.close(id); throw error; }
  },
  async start(id: string) {
    const session = sessions.get(id), state = applicationTaskStore.getState().sessions.get(id);
    if (!session || !state) return;
    if (session.starting) return session.starting;
    if (session.runtime) return;
    const { account } = state;
    let { entry } = state;
    const signal = session.life.signal;
    const isCurrent = () => !signal.aborted && sessions.get(id) === session;
    const current = () => { assertNotAborted(signal); if (!isCurrent()) throw new Error('session-closed'); };
    const confirm = async (prompt: RuntimePrompt, requestSignal?: AbortSignal) => {
      current(); assertNotAborted(requestSignal);
      await platform.napplet.tasks!.focus(id);
      current(); assertNotAborted(requestSignal);
      return nappletService.requestApproval(prompt, requestSignal ?? signal);
    };
    const start = async () => {
      if (session.cleanup) { await session.cleanup; current(); }
      if (!await canReceiveForAccount(account)) throw new Error('account-unavailable');
      current();
      const launch = async (app: ExploreEntry, delivery?: Record<string, unknown>) => {
        const windowed = await shouldOpenApplicationWindow(app, account);
        current();
        if (windowed) await this.open(app, account, undefined, delivery);
        else await openInlineApplication({ entry: app, account });
      };
      entry = await resolveFavoriteMetadata(account, entry, signal);
      current();
      const canonicalSource = applicationSourceId(entry.address);
      if (canonicalSource !== session.sourceId) {
        const existing = [...sessions].find(([otherId, other]) => otherId !== id && other.account === account && other.sourceId === canonicalSource);
        if (existing) {
          const [otherId, other] = existing;
          let focused = false;
          try { await other.opened; await platform.napplet.tasks!.focus(otherId); focused = true; }
          catch { current(); await this.close(otherId); }
          current();
          if (focused && sessions.get(otherId) === other) {
            rememberAlias(other, session.sourceId);
            for (const alias of session.aliases) rememberAlias(other, alias);
            if (session.delivery) {
              other.delivery = session.delivery;
              if (other.runtime instanceof NappletRuntime) other.runtime.setDelivery(session.delivery);
            }
            await this.close(id);
            return;
          }
        }
        rememberAlias(session, session.sourceId);
        applicationPresence.set(account, session.sourceId, false);
        session.sourceId = canonicalSource;
        applicationPresence.set(account, canonicalSource, true);
      }
      patch(id, { entry });
      const required = entry.release ? [...new Set(['shell', ...entry.required])] : applicationRequirements(entry.kind, entry.required);
      if (entry.kind === 'napp' && required.some(domain => !SUPPORTED_NAPP_DOMAINS.includes(domain))) throw new Error('applications.unsupported');
      const optional = entry.release?.optional.filter(domain => (NAP_DOMAINS as readonly string[]).includes(domain) && !required.includes(domain)) ?? [];
      const sourceId = entry.release?.eventKey ?? applicationSigningSource(entry);
      const scope = { accountPubkey: account, appKey: sourceId };
      const access = entry.release ? await readDomainPermissions(scope, entry.release) : undefined;
      const stored = access ? null : await getData(scope, 'permissions', 'domains'); current();
      const saved: unknown = stored ? JSON.parse(stored) : [];
      let domains = Array.isArray(saved) ? saved.filter((domain): domain is string => typeof domain === 'string' && (required.includes(domain) || optional.includes(domain))) : [];
      if (access) domains = access.domains;
      if (required.some(domain => !domains.includes(domain))) {
        const reviewed = session.reviewed?.length === required.length && required.every(domain => session.reviewed!.includes(domain));
        const answer = reviewed ? 'allow' : await confirm({ title: entry.title, detail: '', accountPubkey: account,
          ...(entry.release ? { app: entry.release, capabilities: { required, optional } } : { application: applicationPresentation(entry) }) });
        current();
        if (!answer || (!entry.release && answer !== 'allow') || (entry.release && answer !== 'allow' && !answer.startsWith('domains:'))) throw new Error('permission-denied');
        const selected: unknown = answer.startsWith('domains:') ? JSON.parse(answer.slice(8)) : [];
        domains = [...required, ...optional.filter(domain => Array.isArray(selected) && selected.includes(domain))];
        if (entry.release && access) domains = resolveDomainPermissions(entry.release, domains, access.denied);
        await setData(scope, 'permissions', 'domains', JSON.stringify(domains)); current();
      }
      const presented = () => { if (isCurrent()) patch(id, { loading: false }); };
      if (entry.release) {
        const release = entry.release;
        await nappletService.install(release, account); current();
        const html = await loadArtifact(release, signal); current();
        const runtime = new NappletRuntime({ accountPubkey: account, release, html, domains,
          theme, confirm, presented,
          configure: (schema, values) => { current(); nappletService.configureExternal(schema, values, value => runtime.saveConfig(value), signal); },
          handlers: async () => {
            current();
            const apps = await readApplicationHandlers(account, 'napplet');
            current();
            return apps.flatMap(app => app.release ? [app.release] : []);
          },
          invoke: (target, delivery) => launch(fromNapplet(target), delivery),
          openBrowser: url => launch(websiteEntry(url)),
        });
        session.runtime = runtime;
        if (session.delivery) runtime.setDelivery(session.delivery);
        const containerId = await runtime.open(); current(); patch(id, { containerId });
      } else {
        const runtime = new ExploreRuntime(account, { ...entry, required }, {
          theme: () => theme().colors, confirm, presented,
          focus: () => { current(); return platform.napplet.tasks!.focus(id); },
          failed: () => { if (isCurrent()) patch(id, { loading: false, error: 'applications.request_failed' }); },
          close: () => { if (!isCurrent()) return; void this.close(id).catch(error => console.warn('[explore] Task cleanup failed', error)); },
          link: url => { current(); void platform.urlOpener.openExternalUrl(url).catch(() => {}); },
          configure: (schema, values, save, configSignal) => { current(); nappletService.configureExternal(schema, values, save, configSignal); },
          applications: async () => {
            current();
            const apps = await readApplicationHandlers(account, 'napp');
            current();
            return apps;
          },
          launch: app => launch(app),
          installed: app => {
            void visit(account, app).then(() => this.open(app, account)).catch(() => {});
          },
          replaced: app => {
            if (!isCurrent()) return;
            if (app) void this.restart(id, app).catch(() => {});
            else void this.close(id).catch(() => {});
          },
          navigated: address => { if (isCurrent()) patch(id, { entry: { ...entry, key: address, address, title: new URL(address).host } }); },
        });
        session.runtime = runtime;
        const containerId = await runtime.start(); current(); patch(id, { containerId });
      }
      await visit(account, entry);
    };
    session.starting = start().catch(async error => {
      if (!isCurrent()) return;
      console.warn('[explore] Application task failed', error);
      if (session.runtime instanceof ExploreRuntime) await session.runtime.stop();
      else await session.runtime?.close().catch(cleanup => console.warn('[explore] Task cleanup failed', cleanup));
      session.runtime = undefined;
      patch(id, { containerId: undefined, loading: false, error: error instanceof Error && error.message.startsWith('applications.') ? error.message : 'applications.request_failed' });
    }).finally(() => { session.starting = undefined; });
    await session.starting;
  },
  async back(id: string) {
    const runtime = sessions.get(id)?.runtime;
    if (runtime && applicationTaskStore.getState().sessions.get(id)?.containerId && await runtime.goBack()) return;
    await this.close(id);
  },
  async restart(id: string, entry: ExploreEntry) {
    const old = sessions.get(id), previous = applicationTaskStore.getState().sessions.get(id);
    if (!old || !previous || applicationSourceId(entry.address) !== old.sourceId) throw new Error('session-closed');
    old.life.abort();
    const cleanup = Promise.resolve(old.runtime instanceof ExploreRuntime ? old.runtime.stop() : old.runtime?.close());
    const candidate: Session = { account: old.account, sourceId: old.sourceId, aliases: old.aliases, opened: old.opened, life: new AbortController(), cleanup, delivery: old.delivery };
    sessions.set(id, candidate);
    patch(id, { entry, containerId: undefined, loading: true, error: undefined });
    await this.start(id);
    const state = applicationTaskStore.getState().sessions.get(id);
    if (sessions.get(id) === candidate && state?.error) {
      throw new Error(state.error);
    }
  },
  async retry(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    if (session.runtime instanceof ExploreRuntime) await session.runtime.stop(); else await session.runtime?.close();
    session.runtime = undefined;
    patch(id, { containerId: undefined, loading: true, error: undefined });
    await this.start(id);
  },
  async close(id: string, native = true) {
    const session = sessions.get(id);
    sessions.delete(id);
    if (session) applicationPresence.set(session.account, session.sourceId, false);
    session?.life.abort();
    try {
      if (session?.runtime instanceof ExploreRuntime) await session.runtime.stop(); else await session?.runtime?.close();
    } finally {
      applicationTaskStore.setState(state => { const next = new Map(state.sessions); next.delete(id); return { sessions: next }; });
      if (native) await platform.napplet.tasks?.close(id);
    }
  },
};
registerNappletLifecycle(account => {
  for (const [id, state] of applicationTaskStore.getState().sessions) if (!account || state.account === account)
    void applicationTasks.close(id).catch(error => console.warn('[explore] Task cleanup failed', error));
});
registerNappletSourceInvalidation((account, sourceId) => {
  for (const [id, state] of applicationTaskStore.getState().sessions)
    if (state.account === account && (state.entry.release?.eventKey === sourceId || state.entry.key === sourceId || applicationSigningSource(state.entry) === sourceId))
      void applicationTasks.close(id).catch(error => console.warn('[explore] Task cleanup failed', error));
});
registerNappletTheme(() => {
  for (const session of sessions.values()) {
    session.runtime?.updateTheme();
  }
});
