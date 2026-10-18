import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { IPC } from './ipc-channels';

const encoded = process.argv.find((arg) => arg.startsWith('--psst-explore='))?.slice('--psst-explore='.length);

// This bridge is never installed in the app renderer or an application iframe.
if (process.isMainFrame && !encoded) {
  contextBridge.exposeInMainWorld('__psstNapplet', {
    post: (raw: string) => {
      if (typeof raw === 'string' && raw.length <= 1500000)
        ipcRenderer.send(IPC.nappletMessage, raw);
    },
  });
  ipcRenderer.on(IPC.nappletReply, (_event, raw: string) => {
    // A DOM event avoids executing response bytes as source code.
    window.postMessage({ __psstHostReply: raw }, window.location.origin);
  });
}

// Remote documents receive only a bounded message transport, never Electron APIs.
if (process.isMainFrame && encoded) {
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  contextBridge.exposeInMainWorld('__exploreDocumentToken',nonce);
  contextBridge.exposeInMainWorld('__psstExplore', {
    post: (raw: string) => { if (typeof raw === 'string' && raw.length <= 1500000) { try {const message=JSON.parse(raw);message.nonce=nonce;ipcRenderer.send(IPC.exploreMessage,JSON.stringify(message));}catch{/* Invalid page messages have no authority. */} } },
  });
  ipcRenderer.on(IPC.exploreReply, (_event, raw: string) => {
    let response;try{response=JSON.parse(raw);}catch{return;}
    if(response.type!=='theme' && response.nonce!==nonce) return;
    window.postMessage({ __psstExploreReply: raw }, window.location.origin);
  });
  void webFrame.executeJavaScript(Buffer.from(encoded, 'base64').toString('utf8')).catch(() => {});
}
