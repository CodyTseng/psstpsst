import { EventEmitter } from 'node:events';
import { request } from 'node:https';
import { fetchNappletResource } from '../napplet-resource';
import { resolvePublicAddresses } from '../napplet-public-dns';

jest.mock('node:https', () => ({ request: jest.fn() }));
jest.mock('../napplet-public-dns', () => ({
  ...jest.requireActual('../napplet-public-dns'), resolvePublicAddresses: jest.fn(),
}));
type Reply = { status?: number; location?: string; bytes?: Buffer };
let replies: Reply[];
beforeEach(() => {
  jest.clearAllMocks();
  replies = [];
  jest.mocked(resolvePublicAddresses).mockResolvedValue([{ address: '104.21.1.2', family: 4 }]);
  jest.mocked(request).mockImplementation(((url: URL, options: any, respond: (response: any) => void) => {
    const req = new EventEmitter() as any;
    req.setTimeout = () => req;
    req.destroy = (error: Error) => { req.emit('error', error); return req; };
    req.end = () => {
      if (options.signal.aborted) { req.destroy(new Error('cancelled')); return; }
      options.lookup(url.hostname, { all: true }, (error: Error | null) => {
        if (error) { req.destroy(error); return; }
        const reply = replies.shift() ?? { status: 302, location: '/loop' };
        const response = new EventEmitter() as any;
        response.statusCode = reply.status ?? 200;
        response.headers = { location: reply.location };
        response.destroy = jest.fn((error?: Error) => { if (error) response.emit('error', error); });
        respond(response);
        response.emit('data', reply.bytes ?? Buffer.from('verified bytes'));
        response.emit('end');
      });
    };
    return req;
  }) as typeof request);
});

it('follows relative and cross-host redirects with a fresh public DNS lookup for every hop', async () => {
  replies = [{ status: 302, location: '/Asset' }, { status: 307, location: 'https://cdn.example/Final?Key=ABC' }, { bytes: Buffer.from('app') }];
  await expect(fetchNappletResource('https://blossom.example/hash', 100)).resolves.toEqual(new Uint8Array(Buffer.from('app')));
  expect(jest.mocked(request).mock.calls.map(call => String(call[0]))).toEqual([
    'https://blossom.example/hash', 'https://blossom.example/Asset', 'https://cdn.example/Final?Key=ABC',
  ]);
  expect(jest.mocked(resolvePublicAddresses).mock.calls.map(call => call[0])).toEqual(['blossom.example', 'blossom.example', 'cdn.example']);
});
it.each(['http://public.example/', 'https://127.0.0.1/', 'https://10.0.0.1/', 'https://user:pass@public.example/', 'https://public.example:444/'])('blocks redirect to %s before connecting', async location => {
  replies = [{ status: 302, location }];
  await expect(fetchNappletResource('https://blossom.example/hash', 100)).rejects.toThrow('blocked-by-policy');
  expect(request).toHaveBeenCalledTimes(1);
});
it('rejects a redirect hostname that fails public DNS validation', async () => {
  replies = [{ status: 302, location: 'https://private.example/' }];
  jest.mocked(resolvePublicAddresses).mockResolvedValueOnce([{ address: '104.21.1.2', family: 4 }]).mockRejectedValueOnce(new Error('blocked-by-policy'));
  await expect(fetchNappletResource('https://blossom.example/hash', 100)).rejects.toThrow('blocked-by-policy');
});
it('bounds loops, redirected response sizes and cancellation', async () => {
  await expect(fetchNappletResource('https://blossom.example/loop', 100)).rejects.toThrow('redirect-limit');
  expect(request).toHaveBeenCalledTimes(6);
  replies = [{ status: 302, location: '/big' }, { bytes: Buffer.alloc(101) }];
  await expect(fetchNappletResource('https://blossom.example/hash', 100)).rejects.toThrow('too-large');
  const controller = new AbortController(); controller.abort();
  await expect(fetchNappletResource('https://blossom.example/hash', 100, controller.signal)).rejects.toThrow('cancelled');
});
