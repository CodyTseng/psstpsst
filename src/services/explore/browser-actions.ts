import i18n from '@/i18n/core';
import { platform } from '@/platform';
import { assertNotAborted } from '@/platform/abort';
import { randomId } from '@/services/napplet/protocol';
import type { RuntimePrompt } from '@/services/napplet/runtime';
import type { ApplicationInfo } from './model';
import { NappDevice } from './device';
import type { BrowserRequest } from '@/platform/ports/explore';

export class BrowserActions {
  private device: NappDevice;
  private tickets = new Map<string, number>();
  private permissions = new Set<string>();
  constructor(private options: { application: ApplicationInfo; account: string; signal: AbortSignal;
    confirm(prompt: RuntimePrompt, signal: AbortSignal): Promise<string | false>; open(url: string): Promise<void> }) {
    this.device = new NappDevice(options.application, options.account, options.signal, options.confirm);
  }
  private check() { assertNotAborted(this.options.signal); }
  async approve(request: Omit<BrowserRequest, 'id'>): Promise<boolean> {
    this.check();
    if (request.url !== undefined && (typeof request.url !== 'string' || request.url.length > 8192) ||
      request.filename !== undefined && (typeof request.filename !== 'string' || request.filename.length > 256) ||
      request.resources !== undefined && (!Array.isArray(request.resources) || request.resources.length > 8 || request.resources.some(value => typeof value !== 'string' || value.length > 64)))
      throw new Error('invalid-browser-request');
    const action = request.action;
    const labels: Record<string, string> = { 'media': 'browser_camera_microphone', 'video': 'browser_camera', 'audio': 'browser_microphone',
      'geolocation': 'browser_location', 'notifications': 'browser_notifications', 'fullscreen': 'browser_fullscreen', 'clipboard-read': 'browser_clipboard_read' };
    const resources = request.resources?.map(resource => i18n.t(`napplets.${labels[resource] ?? 'browser_permission'}`)).join('\n');
    const answer = await this.options.confirm({ title: i18n.t(`napplets.browser_${action === 'permission' ? 'permission' : action === 'download' ? 'download' : action === 'external' ? 'external' : 'window'}`),
      detail: [resources, request.url, request.filename].filter(Boolean).join('\n'), application: this.options.application,
      browser: { action } }, this.options.signal);
    this.check(); return answer === 'allow';
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
      if (!await this.approve({ action: 'permission', resources })) return 'default';
      if (resources.includes('notifications') && !await platform.notifications.ensurePermission(this.options.application.title)) return 'denied';
      for (const resource of resources) this.permissions.add(resource);
      return 'granted';
    }
    if (method === 'notify') {
      if (!this.permissions.has('notifications')) throw new Error('permission-denied');
      const [title, body] = args;
      if (typeof title !== 'string' || title.length > 256 || typeof body !== 'string' || body.length > 4096) throw new Error('invalid-notification');
      if (!platform.notifications.presentWebsite) throw new Error('notification-unavailable');
      return platform.notifications.presentWebsite(this.options.application.title, title, body);
    }
    throw new Error('unsupported-method');
  }
}
