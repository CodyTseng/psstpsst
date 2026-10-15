import { base64 } from '@scure/base';
import {
  decodeNappletBytes,
  decodeNappletHtml,
  encodeNappletBytes,
} from '@/platform/napplet-bytes';

test('bridge codecs preserve padding and chunk boundaries', async () => {
  const bytes = Uint8Array.from({ length: 300007 }, (_, index) => index % 251);
  const encoded = await encodeNappletBytes(bytes);
  expect(encoded).toBe(base64.encode(bytes));
  expect(await decodeNappletBytes(encoded)).toEqual(bytes);
});

test('streaming UTF-8 decoding preserves split multi-byte characters', async () => {
  const source = `${'x'.repeat(262143)}你🙂`;
  expect(await decodeNappletHtml(new TextEncoder().encode(source))).toBe(source);
  await expect(decodeNappletHtml(new Uint8Array([255]))).rejects.toThrow();
});

test('cancelled transfers do not materialize unused output', async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(decodeNappletBytes('', abort.signal)).rejects.toThrow();
  await expect(encodeNappletBytes(new Uint8Array(), abort.signal)).rejects.toThrow();
});
