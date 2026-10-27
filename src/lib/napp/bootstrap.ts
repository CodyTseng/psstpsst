import { installBrowserCompat } from './browser-compat';
import { observePageAppearance } from './page-appearance';
// This module is bundled as browser source before the host runtime compiles it.
export function install(options: {
  napp: boolean;
  domains: string[];
  instance?: string;
  theme?: {
    background: string;
    text: string;
    primary: string;
  };
}) {
  if (window.top !== window || (window as any).__psstExploreInstalled)
    return;
  (window as any).__psstExploreInstalled = true;
  const applyTheme = (theme: typeof options.theme) => {
    if (!options.napp || !theme)
      return;
    const apply = () => {
      const root = document.documentElement;
      root.style.setProperty('--surface', theme.background);
      root.style.setProperty('--text', theme.text);
      root.style.setProperty('--accent', theme.primary);
      const color = theme.background.replace('#', '');
      const dark = /^[a-f0-9]{6}$/i.test(color) && (parseInt(color.slice(0, 2), 16) + parseInt(color.slice(2, 4), 16) + parseInt(color.slice(4, 6), 16)) < 384;
      root.dataset.theme = dark ? 'dark' : 'light';
      root.style.colorScheme = dark ? 'dark' : 'light';
    };
    if (document.documentElement)
      apply();
    else
      addEventListener('DOMContentLoaded', apply, { once: true });
  };
  applyTheme(options.theme);
  const nonce=(window as any).__exploreDocumentToken??Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(!(window as any).__exploreDocumentToken) Object.defineProperty(window,'__exploreDocumentToken',{value:nonce});
  let serial = 0;
  const pending = new Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
  }>();
  const streams = new Map<string, (value: any) => void>();
  const handlers = new Map<string, Function | undefined>();
  let previousIndex = 0;
  const indexKey = '__action_popstate_idx';
  const navigation = window.history;
  const pushState = navigation?.pushState.bind(navigation);
  const replaceState = navigation?.replaceState.bind(navigation);
  const index = () => typeof navigation?.state?.[indexKey] === 'number' ? navigation.state[indexKey] : 0;
  if (options.napp && navigation) {
    navigation.pushState = (data, unused, url) => {
      pushState!(data && typeof data === 'object' ? { ...data, [indexKey]: index() + 1 } : data, unused, url);
      previousIndex = index();
    };
    navigation.replaceState = (data, unused, url) => replaceState!(data && typeof data === 'object' ? { ...data, [indexKey]: index() } : data, unused, url);
    previousIndex = index();
    addEventListener('popstate', () => {
      const old = previousIndex;
      // Keep the previous index available to every listener during this dispatch.
      queueMicrotask(() => { if (previousIndex === old) previousIndex = index(); });
    });
  }
  const queued: string[] = [];
  const transmit = (raw: string) => {
    const w = window as any;
    raw = JSON.stringify({ ...JSON.parse(raw), documentToken: w.__exploreNativeDocumentToken });
    if (w.__psstExplore)
      w.__psstExplore.post(raw);
    else if (w.webkit?.messageHandlers?.nappletHost)
      w.webkit.messageHandlers.nappletHost.postMessage(raw);
    else if (w.__nappletHost)
      w.__nappletHost.postMessage(raw);
  };
  const post = (raw: string) => {
    if (!(window as any).__exploreDocumentCommitted) {
      queued.push(raw);
      return;
    }
    transmit(raw);
  };
  (window as any).__exploreCommit = () => {
    if (!(window as any).__exploreDocumentCommitted) return;
    for (const raw of queued.splice(0)) transmit(raw);
  };
  if (!(window as any).__psstExplore)
    observePageAppearance(color => post(JSON.stringify({ type: 'psst.appearance', color })));
  const receive = (raw: unknown) => {
    try {
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (value?.type === 'theme') {
        applyTheme(value.value);
        return;
      }
      if(value.nonce!==nonce) return;
      if (value.type === 'nap') { window.postMessage(value.message, '*'); return; }
      if (value.type === 'action') {
        const handler = handlers.get(value.name) ?? (value.name.startsWith('view:') ? handlers.get('view') : undefined);
        Promise.resolve().then(() => {
          const state = { action: { name: value.name, payload: value.payload }, [indexKey]: index() + 1 };
          pushState?.(state, '');
          dispatchEvent(new PopStateEvent('popstate', { state }));
          return handler?.(value.name, value.payload);
        }).then(result => call('actionResult', [value.requestId, result ?? null]))
          .catch(error => call('actionResult', [value.requestId, null, String(error?.message ?? error).slice(0, 400)]))
          .catch(() => {});
        return;
      }
      if (value.type === 'stream') { streams.get(value.streamId)?.(value); return; }
      const request = pending.get(value.id);
      if (!request)
        return;
      pending.delete(value.id);
      clearTimeout(request.timer);
      if (value.error)
        request.reject(new Error(value.error));
      else
        request.resolve(value.result);
    }
    catch { /* Ignore unrelated document messages. */ }
  };
  (window as any).__exploreReceive = receive;
  addEventListener('message', (event) => { if (event.source === window && event.data?.__psstExploreReply)
    receive(event.data.__psstExploreReply); });
  const call = (method: string, args: unknown[] = []) => new Promise<any>((resolve, reject) => {
    const id = String(++serial);
    const raw = JSON.stringify({ id, nonce, method, args });
    const timer = method === 'sync' ? undefined : setTimeout(() => { pending.delete(id); reject(new Error('request-timeout')); }, 1020000);
    pending.set(id, { resolve, reject, timer });
    try { post(raw); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
  installBrowserCompat(call);
  (window as any).webln = {
    enable: () => call('webln.enable'),
    isEnabled: () => call('webln.isEnabled'),
    getInfo: () => call('webln.getInfo'),
    sendPayment: (invoice: string) => call('webln.sendPayment', [invoice]),
    makeInvoice: (args: unknown) => call('webln.makeInvoice', [args]),
  };

  (window as any).nostr = { getPublicKey: () => call('getPublicKey'), signEvent: (event: unknown) => call('signEvent', [event]) };
  for (const algorithm of ['nip04', 'nip44']) (window as any).nostr[algorithm] = {
    encrypt: (pubkey: string, text: string) => call(`${algorithm}.encrypt`, [pubkey, text]),
    decrypt: (pubkey: string, text: string) => call(`${algorithm}.decrypt`, [pubkey, text]),
  };
  const openStream = (method: string, args: unknown[], receive: (message: any) => void) => {
    const id = `stream:${++serial}`;
    streams.set(id, receive);
    const close = () => { if (streams.delete(id)) void call('streamClose', [id]).catch(() => {}); };
    void call(method, [id,...args]).catch(error => { receive({ phase:'closed',error:error.message });close(); });
    return close;
  };
  const storeSubscribe = (filters: unknown) => {
    const queue: any[] = [];
    let head = 0;
    const waiting: { resolve: (value: IteratorResult<any>) => void; reject: (error: Error) => void }[] = [];
    let closed = false, failure: Error | undefined;
    const finish = (error?: Error) => {
      if (closed) return;
      closed=true;failure=error;queue.length=0;head=0;close();
      for(const waiter of waiting.splice(0)) if(error) waiter.reject(error);else waiter.resolve({done:true,value:undefined});
    };
    const close = openStream('storeSubscribe',[filters], message => {
      if(closed)return;
      if(message.phase==='closed'){finish(new Error(message.error??'subscription-closed'));return;}
      const event=message.event;
      const waiter=waiting.shift();
      if(waiter)waiter.resolve({done:false,value:event});
      else {
        queue.push(event);
      }
    });
    return {
      [Symbol.asyncIterator]() { return this; },
      next(): Promise<IteratorResult<any>> {
        if(failure)return Promise.reject(failure);
        if(head<queue.length){
          const event=queue[head];queue[head++]=undefined;
          if(head===queue.length){queue.length=0;head=0;}
          else if(head>=1024&&head*2>=queue.length){queue.splice(0,head);head=0;}
          return Promise.resolve({done:false,value:event});
        }
        if(closed)return Promise.resolve({done:true,value:undefined});
        return new Promise((resolve,reject)=>waiting.push({resolve,reject}));
      },
      return() { finish();return Promise.resolve({done:true as const,value:undefined}); },
      throw(error: Error) { finish(error);return Promise.reject(error); },
    };
  };
  (window as any).nostrdb = { query: (filters: unknown) => call('query', [filters]), event: (id: string) => call('storeEvent', [id]).then(event=>event??undefined),
    count: (filters: unknown) => call('count', [filters]), add:(event:unknown)=>call('storeAdd',[event]),
    remove:(ids:string[])=>call('storeRemove',[ids]),
    replaceable:(kind:number,author:string,identifier?:string)=>call('storeReplaceable',[kind,author,identifier]).then(event=>event??undefined),
    subscribe:storeSubscribe, supports:async()=>[],
  };
  if (options.napp) {
    const napRequests = new Set(['config.registerSchema', 'config.get', 'config.subscribe', 'config.unsubscribe', 'config.openSettings',
      'inc.emit', 'inc.subscribe', 'inc.unsubscribe', 'inc.channel.open', 'inc.channel.list', 'inc.channel.emit', 'inc.channel.broadcast', 'inc.channel.close']);
    addEventListener('message', event => {
      if (event.source !== window || !napRequests.has(event.data?.type) || !options.domains.includes(event.data.type.split('.')[0])) return;
      void call('nap', [event.data]).catch(error => {
        if (event.data.type.startsWith('config.')) window.postMessage({ type: 'config.schemaError', code: error.message, error: error.message }, '*');
        if (event.data.id) window.postMessage({ type: `${event.data.type}.result`, id: event.data.id, ok: false, error: error.message }, '*');
      });
    });
    const reportError = (error: unknown) => {
      const value = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      void call('log', [value.slice(0, 400)]).catch(() => {});
    };
    addEventListener('error', event => reportError(event.error ?? event.message));
    addEventListener('unhandledrejection', event => reportError(event.reason));
    const relaySubscribe = (relays: string[], filter: unknown, options: any = {}, outbox = false) => {
      const reasons: Record<string,string> = {};
      const close=openStream(outbox ? 'outboxSubscribe' : 'relaySubscribe',[relays,filter,{maxEoseTimeout:options.maxEoseTimeout,label:options.label}],message=>{
        try {
          if(message.phase==='event')options.liveEventCallback?.(message.event);
          else if(message.phase==='eose')options.eoseCallback?.(message.url);
          else if(message.phase==='relayClosed') {
            reasons[message.url]=message.reason;
            if(!outbox && relays.every(url=>reasons[new URL(url).href]!==undefined))options.closedCallback?.(reasons);
          } else if(message.phase==='closed'){close();options.closedCallback?.(message.reasons ?? {host:message.error??'subscription-closed'});}
        } catch(error){close();reportError(error);}
      });
      return close;
    };
    const saveFile = async (name: string, data: Blob | ArrayBuffer | ArrayBufferView, type?: string) => {
      const blob = data instanceof Blob ? data : undefined;
      const bytes = blob ? undefined : (data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined);
      if (!blob && !bytes) throw new Error('invalid-file');
      const size = blob ? blob.size : bytes!.byteLength;
      const mime = (type || blob?.type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      const transfer = await call('utils.saveFile.begin', [name, size, mime]);
      try {
        for (let offset = 0; offset < size; offset += transfer.chunkBytes) {
          const chunk = blob ? new Uint8Array(await blob.slice(offset, offset + transfer.chunkBytes).arrayBuffer()) : bytes!.subarray(offset, offset + transfer.chunkBytes);
          let binary = '';
          for (let index = 0; index < chunk.length; index += 8192) binary += String.fromCharCode(...chunk.subarray(index, index + 8192));
          await call('utils.saveFile.chunk', [transfer.id, btoa(binary)]);
        }
        return await call('utils.saveFile.finish', [transfer.id]);
      } catch (error) { await call('utils.saveFile.cancel', [transfer.id]).catch(() => {}); throw error; }
    };
    (window as any).napp = { ready: Promise.resolve(), log: (message: unknown) => { void call('log', [String(message)]).catch(() => { }); },
      instance: options.instance,
      get __popstate_last_idx() { return previousIndex; },
      close: () => call('close'), link: (url: string) => call('link', [url]),
      registerAction: (name: string, handler?: Function) => {
        if (typeof name !== 'string' || !name) throw new Error('invalid-action');
        handlers.set(name, handler);
        void call('registerAction', [name]).catch(reportError);
      },
      action: (name: string, payload: unknown, target?: {instance?: string; auxiliary?: boolean}) => call('action', [name, payload, target]),
      relays: { health: (urls: string[]) => call('relayHealth', [urls]) },
      sync: (authors: string[], kinds: number[], options?: object) => call('sync', [authors, kinds, options]),
      outbox: (filter: unknown, options?: object) => ({ close: relaySubscribe([], filter, options, true) }),
      utils: { publish: (event: unknown, relays?: string[]) => call('utils.publish', [event, relays]),
        subscribe: relaySubscribe,
        loadEvent: (code: unknown, relays?: string[], author?: string) => call('utils.loadEvent', [code, relays, author]),
        loadEvents: (ids: string[]) => call('utils.loadEvents', [ids]),
        loadNostrUser: (request: string | { pubkey: string; relays?: string[] }) => call('utils.loadNostrUser', [request]),
        loadRelayInfo: (url: string) => call('utils.loadRelayInfo', [url]),
        searchUserLocal: (term: string) => call('utils.searchUserLocal', [term]),
        searchUser: (term: string) => call('utils.searchUser', [term]),
        findAuthors: (term: string, options?: object) => call('utils.findAuthors', [term, options]),
        copyText: (text: string) => call('utils.copyText', [text]), saveFile,
        verifyEvent: (event: unknown) => call('verifyEvent', [event]) } };
    for (const method of ['loadRelayList', 'loadFollowsList', 'loadMuteList', 'loadBookmarks', 'loadPins', 'loadBlossomServers',
      'loadEmojis', 'loadFavoriteRelays', 'loadBlockedRelays', 'loadSearchRelays', 'loadDmRelays', 'loadWikiAuthors', 'loadWikiRelays',
      'loadFavoriteFollowSets', 'loadFavoriteScrolls', 'loadProfileBadges', 'loadSimpleGroups', 'loadGitAuthors', 'loadGitRepositories',
      'loadMediaFollows', 'loadFavoritePodcasts', 'loadAuthoredPodcasts', 'fetchFavoriteRelaysWithSets', 'fetchEmojisWithSets',
      'fetchFavoriteFollowSetsWithSets', 'loadFollowSets', 'loadRelaySets', 'loadEmojiSets'])
      (window as any).napp.utils[method] = (pubkey: string) => call(`utils.${method}`, [pubkey]);
    if (options.domains.includes('dev')) (window as any).napp.dev = {
      installLocal: async (files: { path: string; data: Blob | ArrayBuffer | ArrayBufferView | string; type?: string }[]) => {
        if (!Array.isArray(files) || !files.length || files.length > 5000) throw new Error('invalid-install-files');
        let total = 0;
        const parts = files.map(file => {
          const value = file?.data;
          const blob = value instanceof Blob ? value : typeof value === 'string' ? new Blob([value])
            : value instanceof ArrayBuffer ? new Blob([value]) : ArrayBuffer.isView(value)
              ? new Blob([new Uint8Array(value.buffer, value.byteOffset, value.byteLength) as Uint8Array<ArrayBuffer>]) : undefined;
          if (!blob || typeof file.path !== 'string') throw new Error('invalid-install-files');
          total += blob.size;
          if (total > 32 * 1024 * 1024) throw new Error('installation-too-large');
          return { path: file.path, blob, type: file.type || blob.type || undefined };
        });
        const transfer = await call('dev.installLocal.begin', [parts.map(file => ({ path: file.path, size: file.blob.size, type: file.type }))]);
        try {
          for (const [index, file] of parts.entries()) {
            // Empty files still send one credited chunk so the host can advance its file index.
            for (let offset = 0; offset < Math.max(1, file.blob.size); offset += transfer.chunkBytes) {
              const bytes = new Uint8Array(await file.blob.slice(offset, offset + transfer.chunkBytes).arrayBuffer());
              let binary = '';
              for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
              await call('dev.installLocal.chunk', [transfer.id, index, btoa(binary)]);
            }
          }
          return await call('dev.installLocal.finish', [transfer.id]);
        } catch (error) { await call('dev.installLocal.cancel', [transfer.id]).catch(() => {}); throw error; }
      },
    };
    let ready: Promise<void> | undefined;
    Object.defineProperty((window as any).napp, 'ready', { get() {
      if (!ready) {
        ready = call('instance').then(instance => { (window as any).napp.instance = instance; });
        void ready.catch(reportError);
      }
      return ready;
    } });
  }
  requestAnimationFrame(() => requestAnimationFrame(() => post(JSON.stringify({ id: 'ready', nonce, method: 'ready', args: [] }))));
}
