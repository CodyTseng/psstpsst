/** Shared document-start bridge. Only the platform transport assigns origin authority. */
export function exploreBridge(napp: boolean, theme?: {
  background: string;
  text: string;
  primary: string;
}): string {
  return `(${bootstrap.toString()})(${JSON.stringify({ napp, theme })});`;
}
// Keep this function self-contained: its source executes in isolated application documents.
function bootstrap(options: {
  napp: boolean;
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
    timer: ReturnType<typeof setTimeout>;
  }>();
  const streams = new Map<string, (value: any) => void>();
  const post = (raw: string) => {
    const w = window as any;
    if (w.__psstExplore)
      w.__psstExplore.post(raw);
    else if (w.webkit?.messageHandlers?.nappletHost)
      w.webkit.messageHandlers.nappletHost.postMessage(raw);
    else if (w.__nappletHost)
      w.__nappletHost.postMessage(raw);
  };
  const receive = (raw: unknown) => {
    try {
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (value?.type === 'theme') {
        applyTheme(value.value);
        return;
      }
      if(value.nonce!==nonce) return;
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
    if (pending.size >= 16)
      return reject(new Error('quota-exceeded'));
    const id = String(++serial);
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('request-timeout')); }, 460000);
    pending.set(id, { resolve, reject, timer });
    post(JSON.stringify({ id, nonce, method, args }));
  });
  (window as any).nostr = { getPublicKey: () => call('getPublicKey'), signEvent: (event: unknown) => call('signEvent', [event]) };
  if (options.napp) {
    const reportError = (error: unknown) => {
      const value = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      void call('log', [value.slice(0, 400)]).catch(() => {});
    };
    addEventListener('error', event => reportError(event.error ?? event.message));
    addEventListener('unhandledrejection', event => reportError(event.reason));
    const openStream = (method: string, args: unknown[], receive: (message: any) => void) => {
      if (streams.size >= 8) throw new Error('subscription-quota-exceeded');
      const id = `stream:${++serial}`;
      streams.set(id, receive);
      const close = () => { if (streams.delete(id)) void call('streamClose', [id]).catch(() => {}); };
      void call(method, [id,...args]).catch(error => { receive({ phase:'closed',error:error.message });close(); });
      return close;
    };
    const storeSubscribe = (filters: unknown) => {
      const queue: any[] = [];
      const waiting: { resolve: (value: IteratorResult<any>) => void; reject: (error: Error) => void }[] = [];
      let closed = false, failure: Error | undefined, bytes = 0;
      const finish = (error?: Error) => {
        if (closed) return;
        closed=true;failure=error;queue.length=0;bytes=0;close();
        for(const waiter of waiting.splice(0)) if(error) waiter.reject(error);else waiter.resolve({done:true,value:undefined});
      };
      const close = openStream('storeSubscribe',[filters], message => {
        if(closed)return;
        if(message.phase==='closed'){finish(new Error(message.error??'subscription-closed'));return;}
        const event=message.event;
        const waiter=waiting.shift();
        if(waiter)waiter.resolve({done:false,value:event});
        else {
          bytes+=JSON.stringify(event).length*2;
          if(queue.length>=128||bytes>2*1024*1024){finish(new Error('subscription-overflow'));return;}
          queue.push(event);
        }
      });
      return {
        [Symbol.asyncIterator]() { return this; },
        next(): Promise<IteratorResult<any>> {
          if(failure)return Promise.reject(failure);
          if(queue.length){const event=queue.shift();bytes-=JSON.stringify(event).length*2;return Promise.resolve({done:false,value:event});}
          if(closed)return Promise.resolve({done:true,value:undefined});
          if(waiting.length>=16)return Promise.reject(new Error('quota-exceeded'));
          return new Promise((resolve,reject)=>waiting.push({resolve,reject}));
        },
        return() { finish();return Promise.resolve({done:true as const,value:undefined}); },
        throw(error: Error) { finish(error);return Promise.reject(error); },
      };
    };
    const relaySubscribe = (relays: string[], filter: unknown, options: any = {}) => {
      let initial: any[] = [], bytes = 0;
      const reasons: Record<string,string> = {};
      const close=openStream('relaySubscribe',[relays,filter,{maxEoseTimeout:options.maxEoseTimeout}],message=>{
        try {
          if(message.phase==='initial') {
            bytes+=JSON.stringify(message.event).length*2;
            if(initial.length>=1000||bytes>2*1024*1024)throw new Error('subscription-overflow');
            initial.push(message.event);
          } else if(message.phase==='eose') { const events=initial;initial=[];bytes=0;options.eoseEventsCallback?.(events); }
          else if(message.phase==='event')options.liveEventCallback?.(message.event);
          else if(message.phase==='relayClosed') {
            reasons[message.url]=message.reason;
            if(relays.every(url=>reasons[new URL(url).href]!==undefined))options.closedCallback?.(reasons);
          } else if(message.phase==='closed'){close();options.closedCallback?.({host:message.error??'subscription-closed'});}
        } catch(error){close();reportError(error);}
      });
      return ()=>{initial=[];close();};
    };
    const handlers = new Map<string, Function>();
    (window as any).napp = { ready: Promise.resolve(), log: (message: unknown) => { void call('log', [String(message)]).catch(() => { }); },
      close: () => call('close'), link: (url: string) => call('link', [url]),
      registerAction: (name: string, handler: Function) => { handlers.set(name, handler); },
      action: (name: string, payload: unknown) => call('action', [name, payload]),
      utils: { publish: (event: unknown, relays?: string[]) => call('publish', [event, relays]),
        subscribe: relaySubscribe,
        loadEvent: (code: unknown) => call('loadEvent', [code]),
        loadNostrUser: (request: string | { pubkey: string; relays?: string[] }) => call('profile', [request]),
        loadRelayList: (pubkey: string) => call('relayList', [pubkey]),
        verifyEvent: (event: unknown) => call('verifyEvent', [event]) } };
    (window as any).nostrdb = { query: (filters: unknown) => call('query', [filters]), event: (id: string) => call('storeEvent', [id]).then(event=>event??undefined),
      count: (filters: unknown) => call('count', [filters]), add:(event:unknown)=>call('storeAdd',[event]).then(()=>{}),
      remove:(ids:string[])=>call('storeRemove',[ids]),
      replaceable:(kind:number,author:string,identifier?:string)=>call('storeReplaceable',[kind,author,identifier]).then(event=>event??undefined),
      subscribe:storeSubscribe, supports:()=>[],
    };
  }
  requestAnimationFrame(() => requestAnimationFrame(() => post(JSON.stringify({ id: 'ready', nonce, method: 'ready', args: [] }))));
}
