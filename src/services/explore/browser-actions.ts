import i18n from '@/i18n/core';
import { automaticBrowserPermission, rememberBrowserPermission, browserPermissionLabel } from './browser-permissions';
import { platform } from '@/platform';
import { assertNotAborted } from '@/platform/abort';
import { randomId } from '@/services/napplet/protocol';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import type { ApplicationInfo } from './model';
import { NappDevice } from './device';
import { readBrowserPermissions, saveBrowserPermissions } from './browser-permission-store';
import { SIGNING_PERIODS } from '@/services/signing/model';
import { signingRevision, subscribeSigning } from '@/services/signing/changes';
import { queueAuthorization } from '@/services/signing/authorization-queue';
import type { BrowserRequest } from '@/platform/ports/explore';

export class BrowserActions {
  private device: NappDevice;
  private tickets = new Map<string, number>();
  private permissions = new Map<string, number>();
  constructor(private options: { application: ApplicationInfo; account: string; sourceId: string; signal: AbortSignal;
    confirm(prompt: RuntimePrompt, signal: AbortSignal): Promise<string | false>; open(url: string): Promise<void>; permissionsChanged?(): void }) {
    this.device = new NappDevice(options.application, options.account, options.signal, options.confirm);
    const detach = subscribeSigning(this.scope, change => {
      if (change.key !== undefined && !change.key.startsWith('browser:')) return;
      this.permissions.clear(); options.permissionsChanged?.();
    });
    options.signal.addEventListener('abort', detach, { once: true });
  }
  private get scope() { return { accountPubkey: this.options.account, sourceId: this.options.sourceId }; }
  private check() { assertNotAborted(this.options.signal); }
  async approve(request: Omit<BrowserRequest, 'id'>): Promise<boolean> {
    return (await this.authorize(request)).allowed;
  }
  async authorize(request: Omit<BrowserRequest, 'id'>): Promise<{ allowed: boolean; expiresAt?: number | null }> {
    const frozen = JSON.parse(JSON.stringify(request)) as Omit<BrowserRequest, 'id'>;
    return queueAuthorization(this.scope, [this.options.signal], () => this.authorizeCurrent(frozen));
  }
  private async authorizeCurrent(request: Omit<BrowserRequest, 'id'>): Promise<{ allowed: boolean; expiresAt?: number | null }> {
    this.check();
    if (request.url !== undefined && (typeof request.url !== 'string' || request.url.length > 8192) ||
      request.filename !== undefined && (typeof request.filename !== 'string' || request.filename.length > 256) ||
      request.resources !== undefined && (!Array.isArray(request.resources) || request.resources.length > 8 || request.resources.some(value => typeof value !== 'string' || value.length > 64)))
      throw new Error('invalid-browser-request');
    const action = request.action;
    const resources = [...new Set(request.resources ?? [])];
    if (action === 'permission' && resources.length && resources.every(automaticBrowserPermission)) return { allowed: true, expiresAt: null };
    const requested = resources.filter(resource => !automaticBrowserPermission(resource));
    const remember = action === 'permission' && rememberBrowserPermission(requested);
    const revision = signingRevision(this.scope);
    const current = () => { this.check(); if (signingRevision(this.scope) !== revision) throw new Error('permissions-changed'); };
    let needed = requested;
    let until = Infinity;
    if (remember && requested.every(resource => (this.permissions.get(resource) ?? 0) > Date.now())) {
      const expiry = Math.min(...requested.map(resource => this.permissions.get(resource)!));
      return { allowed: true, expiresAt: Number.isFinite(expiry) ? expiry : null };
    }
    if (remember) {
      const saved = new Map((await readBrowserPermissions(this.scope)).map(rule => [rule.resource, rule]));
      current();
      needed = requested.filter(resource => {
        const local = this.permissions.get(resource);
        if (local !== undefined && local > Date.now()) { until = Math.min(until, local); return false; }
        const rule = saved.get(resource);
        if (!rule || rule.expiresAt !== null && rule.expiresAt <= Date.now()) return true;
        if (rule.decision === 'deny') return true;
        this.permissions.set(resource, rule.expiresAt ?? Infinity);
        until = Math.min(until, rule.expiresAt ?? Infinity); return false;
      });
      if (requested.some(resource => saved.get(resource)?.decision === 'deny')) return { allowed: false };
      if (!needed.length) return { allowed: true, expiresAt: Number.isFinite(until) ? until : null };
    }
    const answer = await this.options.confirm({ title: i18n.t(`napplets.browser_${action === 'permission' ? 'permission' : action === 'download' ? 'download' : action === 'external' ? 'external' : 'window'}`),
      detail: [needed.map(resource => browserPermissionLabel(resource, i18n.t)).join('\n'), request.url, request.filename].filter(Boolean).join('\n'),
      accountPubkey: this.options.account, application: this.options.application,
      browser: { action, resources: action === 'permission' ? needed : request.resources, url: request.url, filename: request.filename } }, this.options.signal);
    current();
    const period = typeof answer === 'string' ? answer.replace(/^(allow|deny)-/, '') : '';
    const timed = Object.prototype.hasOwnProperty.call(SIGNING_PERIODS, period);
    const allowed = answer === 'allow' || typeof answer === 'string' && (answer === 'allow-always' || timed && answer.startsWith('allow-'));
    const remembered = remember && typeof answer === 'string' && (answer === 'allow-always' || answer === 'deny-always' || timed && /^(allow|deny)-/.test(answer));
    const expiresAt = timed ? Date.now() + SIGNING_PERIODS[period as keyof typeof SIGNING_PERIODS] : null;
    if (remembered) {
      const savedRevision = await saveBrowserPermissions(this.scope, needed, allowed ? 'allow' : 'deny', expiresAt, current);
      this.check();
      if (signingRevision(this.scope) !== savedRevision) throw new Error('permissions-changed');
    }
    // One-time device access belongs to this document, like a browser's current visit.
    if (remember && allowed) for (const resource of needed) this.permissions.set(resource, remembered ? expiresAt ?? Infinity : Infinity);
    if (allowed && expiresAt !== null) until = Math.min(until, expiresAt);
    return { allowed, expiresAt: remember ? Number.isFinite(until) ? until : null : Date.now() };
  }

  async handle(method: string, args: any[]) {
    this.check();
    if (method === 'open' || method === 'external') {
      const url = new URL(String(args[0]));
      if (String(args[0]).length > 8192 || ['javascript:', 'data:', 'file:', 'app:', 'about:', 'chrome:', 'devtools:', 'shell:', 'powershell:', 'cmd:', 'psstpsst-file:'].includes(url.protocol)) throw new Error('invalid-url');
      const external = method === 'external' || !['http:', 'https:'].includes(url.protocol);
      if (!await this.approve({ action: external ? 'external' : 'window', url: url.href })) throw new Error('permission-denied');
      if (external) { if (!await (platform.urlOpener.openApprovedBrowserUrl ?? platform.urlOpener.openExternalUrl)(url.href)) throw new Error('external-open-failed'); }
      else await this.options.open(url.href);
      return;
    }
    if (method === 'clipboard.readText') {
      if (!await this.approve({ action: 'permission', resources: ['clipboard-read'] })) throw new Error('permission-denied');
      return platform.clipboard.readText();
    }
    if (method === 'download.permission') {
      if (this.tickets.size >= 8) for (const [key, until] of this.tickets) if (until < Date.now()) this.tickets.delete(key);
      if (this.tickets.size >= 8) throw new Error('download-quota-exceeded');
      if (!await this.approve({ action: 'download', url: String(args[0]).slice(0, 8192), filename: String(args[1] ?? '').slice(0, 200) })) throw new Error('permission-denied');
      const ticket = randomId(); this.tickets.set(ticket, Date.now() + 120000); return ticket;
    }
    if (method.startsWith('image.') || method.startsWith('download.')) {
      const [kind, operation] = method.split('.');
      if (kind === 'download' && operation === 'begin') {
        const expiry = this.tickets.get(args[3]); this.tickets.delete(args[3]);
        if (!expiry || expiry < Date.now()) throw new Error('permission-denied');
      }
      return this.device.handle(`${kind === 'image' ? 'copyImage' : 'saveFile'}.${operation}`, args, true);
    }
    if (method === 'permission') {
      const resources = args[0];
      if (!Array.isArray(resources) || resources.length > 8 || resources.some(value => typeof value !== 'string')) throw new Error('invalid-permission');
      if (!await this.approve({ action: 'permission', resources })) return 'denied';
      if (resources.includes('notifications') && !await platform.notifications.ensurePermission(this.options.application.title)) return 'denied';
      return 'granted';
    }
    if (method === 'notify') {
      const local = this.permissions.get('notifications');
      if (!(local !== undefined && local > Date.now())) {
        const saved = (await readBrowserPermissions(this.scope)).find(rule => rule.resource === 'notifications');
        this.check();
        if (!saved || saved.decision !== 'allow' || saved.expiresAt !== null && saved.expiresAt <= Date.now()) throw new Error('permission-denied');
      }
      const [title, body] = args;
      if (typeof title !== 'string' || title.length > 256 || typeof body !== 'string' || body.length > 4096) throw new Error('invalid-notification');
      if (!platform.notifications.presentWebsite) throw new Error('notification-unavailable');
      return platform.notifications.presentWebsite(this.options.application.title, title, body);
    }
    throw new Error('unsupported-method');
  }
}
