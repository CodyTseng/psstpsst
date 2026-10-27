import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { IPC } from './ipc-channels';
import { exploreBridge } from '../src/lib/napp/bridge';
import type { ExploreBootstrap } from '../src/platform/ports/explore';

const encoded = process.argv.find((arg) => arg.startsWith('--psst-explore='))?.slice('--psst-explore='.length);
const descriptor = process.argv.find(arg => arg.startsWith('--psst-explore-bootstrap='))?.slice('--psst-explore-bootstrap='.length);
const explore = !!encoded || !!descriptor;

// This bridge is never installed in the app renderer or an application iframe.
if (process.isMainFrame && !explore) {
  contextBridge.exposeInMainWorld('__psstNapplet', {
    post: (raw: string) => {
      if (typeof raw === 'string')
        ipcRenderer.send(IPC.nappletMessage, raw);
    },
  });
  ipcRenderer.on(IPC.nappletReply, (_event, raw: string) => {
    // A DOM event avoids executing response bytes as source code.
    window.postMessage({ __psstHostReply: raw }, window.location.origin);
  });
}

// Remote documents receive only a document-bound message transport, never Electron APIs.
if (process.isMainFrame && explore) {
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  contextBridge.exposeInMainWorld('__exploreDocumentToken',nonce);
  contextBridge.exposeInMainWorld('__psstExplore', {
    post: (raw: string) => { if (typeof raw === 'string') { try {const message=JSON.parse(raw);message.nonce=nonce;ipcRenderer.send(IPC.exploreMessage,JSON.stringify(message));}catch{/* Invalid page messages have no authority. */} } },
  });
  ipcRenderer.on(IPC.exploreReply, (_event, raw: string) => {
    let response;try{response=JSON.parse(raw);}catch{return;}
    if(response.type!=='theme' && response.nonce!==nonce) return;
    window.postMessage({ __psstExploreReply: raw }, window.location.origin);
  });
  let script: string;
  if (descriptor) {
    const bootstrap = JSON.parse(Buffer.from(descriptor, 'base64').toString('utf8')) as ExploreBootstrap;
    script = exploreBridge(bootstrap.napp, bootstrap.theme, bootstrap.domains, bootstrap.instance);
  } else script = Buffer.from(encoded!, 'base64').toString('utf8');
  void webFrame.executeJavaScript(script).catch(() => {});
}
