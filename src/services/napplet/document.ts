import { nappletPrelude } from './prelude.generated';

export const NAPPLET_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'";
const escape = (value: string) =>
  value.replace(/<\/script/gi, '<\\/script').replace(/</g, '\\u003c');

/** The privileged bridge lives in the immutable outer document, never in the artifact. */
export async function buildDocument(
  html: string,
  domains: readonly string[],
  title = '',
): Promise<string> {
  const prelude = `${nappletPrelude}\nNappletShimPrelude.install({domains:${JSON.stringify(domains)}});`;
  const artifact = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${NAPPLET_CSP}"><meta name="referrer" content="no-referrer"><script>${prelude.replace(/<\/script/gi, '<\\/script')}</script>${html}`;
  const encoded: string[] = [];
  for (let offset = 0; offset < artifact.length; offset += 65536) {
    encoded.push(escape(JSON.stringify(artifact.slice(offset, offset + 65536))));
    if (offset && offset % 262144 === 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const source = `[${encoded.join(',')}].join('')`;
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; frame-src 'self' about:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body,iframe{border:0;margin:0;width:100%;height:100%;overflow:hidden}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title=""></iframe><script>
const frame=document.querySelector('iframe');
frame.title=${escape(JSON.stringify(title))};
let budgetStart=Date.now(),budgetCalls=0,budgetBytes=0;
async function rasterSvg(blob){
 if(blob.size>5242880)throw Error('too-large');
 const svg=await blob.text();
 if(/<!DOCTYPE|<!ENTITY|<script|<foreignObject|<iframe/i.test(svg))throw Error('blocked-by-policy');
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 if(doc.documentElement.localName!=='svg'||doc.querySelector('parsererror'))throw Error('decode-failed');
 for(const node of doc.querySelectorAll('*'))for(const attr of node.attributes){
  if(attr.localName.toLowerCase().startsWith('on'))throw Error('blocked-by-policy');
  if(attr.localName==='href'&&!attr.value.startsWith('#')&&!attr.value.startsWith('data:image/'))throw Error('blocked-by-policy');
 }
 if(/url\\(\\s*['"]?(?!#|data:)/i.test(svg))throw Error('blocked-by-policy');
 const url=URL.createObjectURL(blob);
 try{return await new Promise((resolve,reject)=>{
  const image=new Image();const timer=setTimeout(()=>reject(Error('timeout')),2000);
  image.onerror=()=>{clearTimeout(timer);reject(Error('decode-failed'));};
  image.onload=()=>{try{
   const w=image.naturalWidth,h=image.naturalHeight;
   if(!w||!h||w>4096||h>4096||w*h>16777216)throw Error('too-large');
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
   canvas.getContext('2d').drawImage(image,0,0);
   canvas.toBlob(result=>{clearTimeout(timer);if(result&&result.size<=10485760)resolve(result);else reject(Error('too-large'));},'image/png');
  }catch(error){clearTimeout(timer);reject(error);}};image.src=url;
 });}finally{URL.revokeObjectURL(url);}
}
async function hydrate(value){
 if(!value||typeof value!=='object')return value;
 if(value.__nappletBlob){const s=atob(value.__nappletBlob);const b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);const blob=new Blob([b],{type:value.mime});return value.mime==='image/svg+xml'?rasterSvg(blob):blob;}
 if(Array.isArray(value))return Promise.all(value.map(hydrate));
 const out=Object.create(null);for(const [k,v] of Object.entries(value))out[k]=await hydrate(v);
 if(out.blob instanceof Blob)out.mime=out.blob.type;return out;
}
window.__hostReceive=async function(message){try{frame.contentWindow.postMessage(await hydrate(message),'*');}catch(error){frame.contentWindow.postMessage({type:message.type.replace(/\\.result$/,'.error'),id:message.id,error:String(error.message||'decode-failed')},'*');}};
window.addEventListener('message',event=>{
 if(event.source===window && event.data?.__psstHostReply){try{window.__hostReceive(JSON.parse(event.data.__psstHostReply));}catch{}return;}
 if(event.source!==frame.contentWindow||!event.data||typeof event.data!=='object')return;
 if(typeof event.data.type!=='string'||event.data.type.length>80)return;
 if(Date.now()-budgetStart>=1000){budgetStart=Date.now();budgetCalls=0;budgetBytes=0;}
 if(++budgetCalls>32)return;
 let raw;try{raw=JSON.stringify(event.data);}catch{return;}
 budgetBytes+=raw.length;if(raw.length>1500000||budgetBytes>2097152)return;
 if(window.__psstNapplet)window.__psstNapplet.post(raw);
 else if(window.__nappletHost)window.__nappletHost.postMessage(raw);
 else if(window.webkit?.messageHandlers?.nappletHost)window.webkit.messageHandlers.nappletHost.postMessage(raw);
});
frame.srcdoc=${source};
</script>`;
}
