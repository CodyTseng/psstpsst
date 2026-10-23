import { UPLOAD_CHUNK_BYTES, UPLOAD_ACK } from './upload-transport';

/** Binary conversion is confined to the trusted wrapper, preserving the public Blob API. */
export function renderUploadBridge(enabled: boolean): string {
  return `
const uploadCredits=new Map(),uploadBridges=new Set();
function handleUploadAck(message){
 if(message.type!==${JSON.stringify(UPLOAD_ACK)})return false;
 const key=message.id+':'+message.seq,entry=uploadCredits.get(key);
 if(entry){uploadCredits.delete(key);clearTimeout(entry.timer);if(message.error)entry.reject(Error(String(message.error)));else entry.resolve();}
 return true;
}
function uploadCredit(message,deadline){
 return new Promise((resolve,reject)=>{
  if(Date.now()>=deadline){reject(Error('upload-bridge-timeout'));return;}
  const key=message.id+':'+message.seq;
  const timer=setTimeout(()=>{uploadCredits.delete(key);reject(Error('upload-bridge-timeout'));},Math.min(message.seq===-1?1020000:10000,deadline-Date.now()));
  uploadCredits.set(key,{resolve,reject,timer});
  try{const raw=JSON.stringify(message);if(raw.length>100000)throw Error('too-large');postHost(raw);}
  catch(error){uploadCredits.delete(key);clearTimeout(timer);reject(error);}
 });
}
async function bridgeUpload(message){
 if(!${enabled})throw Error('permission-denied');
 if(typeof message.id!=='string'||!message.id||message.id.length>128)throw Error('invalid-request');
 if(uploadBridges.size>=2||uploadBridges.has(message.id))throw Error('quota-exceeded');
 const request=message.request,data=request?.data;
 if(!(data instanceof Blob)&&!(data instanceof ArrayBuffer))throw Error('invalid-upload-data');
 const blob=data instanceof Blob?data:new Blob([data]);
 if(!Number.isSafeInteger(blob.size)||blob.size<1)throw Error('invalid-upload-data');
 const {data:ignored,...metadata}=request;
 metadata.mimeType=request.mimeType||(blob.type.split(';')[0].trim()||'application/octet-stream');
 uploadBridges.add(message.id);
 let deadline=Date.now()+1020000;
 try{
  await uploadCredit({type:'upload.transfer.start',id:message.id,seq:-1,size:blob.size,request:metadata},deadline);
  deadline=Date.now()+25000;
  let seq=0;
  for(let offset=0;offset<blob.size;offset+=${UPLOAD_CHUNK_BYTES}){
   const bytes=new Uint8Array(await blob.slice(offset,offset+${UPLOAD_CHUNK_BYTES}).arrayBuffer());
   let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));
   await uploadCredit({type:'upload.transfer.chunk',id:message.id,seq:seq++,data:btoa(binary)},deadline);
  }
  await uploadCredit({type:'upload.transfer.end',id:message.id,seq},deadline);
 }finally{uploadBridges.delete(message.id);}
}
`;
}
