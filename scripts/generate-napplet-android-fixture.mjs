import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Expected the generated test assets directory');
const bundled = await build({
  entryPoints: ['src/services/napplet/document.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { buildDocument } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const fixture = `<script>
addEventListener('message',event=>{
 if(event.source!==parent||event.data?.type!=='test.push')return;
 history.pushState({page:1},'');history.pushState({page:2},'');
 parent.postMessage({type:'test.navigation',page:2},'*');
});
addEventListener('popstate',()=>parent.postMessage({type:'test.navigation',page:history.state?.page??0},'*'));
(async()=>{
 const result={};
 try{parent.document;result.parentReadable=true;}catch{result.parentReadable=false;}
 try{localStorage.setItem('test','1');result.storage=true;}catch{result.storage=false;}
 try{await fetch('https://blocked.example/leak');result.network=true;}catch{result.network=false;}
 result.bridge=typeof window.__nappletHost;
 await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));result.wasm=true;
 result.pubkey=await napplet.identity.getPublicKey();
 result.image=await new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>resolve(false);image.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';});
 parent.postMessage({type:'test.result',result},'*');
})().catch(error=>parent.postMessage({type:'test.result',error:String(error)},'*'));
</script>`;
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'napplet-fixture.html'), await buildDocument(fixture, ['shell', 'identity']));
