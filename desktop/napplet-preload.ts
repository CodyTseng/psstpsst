import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels';

// This bridge is never installed in the app renderer or an application iframe.
if (process.isMainFrame) {
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
