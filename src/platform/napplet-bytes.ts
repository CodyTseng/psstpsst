import { base64 } from '@scure/base';
import { assertNotAborted } from './abort';

const yieldFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Native bridges carry base64 strings; process them in bounded JS slices. */
export async function decodeNappletBytes(value: string, signal?: AbortSignal): Promise<Uint8Array> {
  assertNotAborted(signal);
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const result = new Uint8Array((value.length / 4) * 3 - padding);
  let position = 0;
  for (let offset = 0; offset < value.length; offset += 65536) {
    assertNotAborted(signal);
    const chunk = base64.decode(value.slice(offset, offset + 65536));
    result.set(chunk, position);
    position += chunk.length;
    if (offset && offset % 262144 === 0) await yieldFrame();
  }
  return result;
}

export async function encodeNappletBytes(value: Uint8Array, signal?: AbortSignal): Promise<string> {
  assertNotAborted(signal);
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += 49152) {
    assertNotAborted(signal);
    chunks.push(base64.encode(value.subarray(offset, offset + 49152)));
    if (offset && offset % 196608 === 0) await yieldFrame();
  }
  return chunks.join('');
}

export async function decodeNappletHtml(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  assertNotAborted(signal);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 262144) {
    assertNotAborted(signal);
    chunks.push(decoder.decode(bytes.subarray(offset, offset + 262144), { stream: true }));
    if (bytes.length > 262144) await yieldFrame();
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}
