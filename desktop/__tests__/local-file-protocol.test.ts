/** @jest-environment node */
import { localFileResponse } from '../local-file-protocol';

const trusted = (origin: string) => origin === 'app://renderer' || origin === 'http://localhost:8081';

it.each(['app://renderer', 'http://localhost:8081'])('allows anonymous media reads from %s', async (origin) => {
  const request = new Request('psstpsst-file://documents/video.mov', { headers: { Origin: origin } });
  const response = new Response('video bytes', { status: 206, headers: {
    'Content-Type': 'video/quicktime', 'Content-Range': 'bytes 0-10/100', Vary: 'Accept-Encoding',
  } });
  const result = localFileResponse(request, response, trusted);
  expect(result.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(result.headers.get('Access-Control-Allow-Headers')).toBe('Range');
  expect(result.headers.get('Content-Range')).toBe('bytes 0-10/100');
  expect(result.headers.get('Content-Type')).toBe('video/quicktime');
  expect(result.headers.get('Vary')).toContain('Accept-Encoding');
  expect(result.headers.get('Vary')).toContain('Origin');
  expect(result.status).toBe(206);
  expect(await result.text()).toBe('video bytes');
});

it.each(['https://untrusted.example', 'null', ''])('does not expose private local files to origin %s', (origin) => {
  const request = new Request('psstpsst-file://documents/video.mov', { headers: origin ? { Origin: origin } : {} });
  const result = localFileResponse(request, new Response('private bytes', {
    headers: { 'Access-Control-Allow-Origin': '*' },
  }), trusted);
  expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
});

it('supports a trusted preflight without a response body', () => {
  const request = new Request('psstpsst-file://documents/video.mov', { method: 'OPTIONS', headers: { Origin: 'app://renderer' } });
  const result = localFileResponse(request, new Response(null, { status: 204 }), trusted);
  expect(result.status).toBe(204);
  expect(result.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, OPTIONS');
});

it('uses Electron initiator metadata when a local media request omits the Origin header', () => {
  const request = Object.assign(new Request('psstpsst-file://documents/video.mov'), { initiatorOrigin: 'app://renderer' });
  const result = localFileResponse(request, new Response('video bytes'), trusted);
  expect(result.headers.get('Access-Control-Allow-Origin')).toBe('app://renderer');
});

it('uses the fixed renderer origin for originless custom-scheme loads without reflecting hostile origins', () => {
  const request = new Request('psstpsst-file://documents/video.mov');
  expect(localFileResponse(request, new Response('video'), trusted, 'app://renderer')
    .headers.get('Access-Control-Allow-Origin')).toBe('app://renderer');
  const hostile = new Request(request.url, { headers: { Origin: 'https://untrusted.example' } });
  expect(localFileResponse(hostile, new Response('video'), trusted, 'app://renderer')
    .headers.get('Access-Control-Allow-Origin')).toBeNull();
});
