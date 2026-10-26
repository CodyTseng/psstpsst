import { createPublicDnsResolver, isPublicAddress } from '../napplet-public-dns';

const publicAnswer = [{ address: '104.21.1.2', family: 4 }];
const fakeAnswer = [{ address: '198.18.0.90', family: 4 }];

it('uses public system DNS without a fallback request', async () => {
  const system = jest.fn(async () => publicAnswer);
  const query = jest.fn();
  expect(await createPublicDnsResolver({ system, query })('cdn.example')).toEqual(publicAnswer);
  expect(query).not.toHaveBeenCalled();
});

it('replaces Fake-IP answers with independently resolved public addresses and bounds cache lifetime', async () => {
  let time = 0;
  const system = jest.fn(async () => fakeAnswer);
  const query = jest.fn(async () => ({ addresses: publicAnswer, ttl: 300 }));
  const resolve = createPublicDnsResolver({ system, query, now: () => time });
  expect(await resolve('cdn.example')).toEqual(publicAnswer);
  expect(isPublicAddress(fakeAnswer[0].address)).toBe(false);
  expect(await resolve('cdn.example')).toEqual(publicAnswer);
  expect(query).toHaveBeenCalledTimes(1);
  time = 60001;
  await resolve('cdn.example');
  expect(query).toHaveBeenCalledTimes(2);
});

it.each(['127.0.0.1', '192.168.1.1', '198.18.0.90', '::1', 'fc00::1'])(
  'never resolves an explicit non-public address through DoH: %s', async (hostname) => {
    const system = jest.fn();
    const query = jest.fn();
    await expect(createPublicDnsResolver({ system, query })(hostname)).rejects.toThrow('blocked-by-policy');
    expect(system).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  },
);

it('rejects mixed private/public fallback answers from both resolvers', async () => {
  const query = jest.fn(async () => ({ addresses: [...publicAnswer, ...fakeAnswer], ttl: 60 }));
  const resolve = createPublicDnsResolver({ system: async () => fakeAnswer, query });
  await expect(resolve('cdn.example')).rejects.toThrow('blocked-by-policy');
  expect(query).toHaveBeenCalledTimes(2);
});

it('tries the second pinned resolver if the first fails', async () => {
  const query = jest.fn().mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ addresses: publicAnswer, ttl: 10 });
  const resolve = createPublicDnsResolver({ system: async () => fakeAnswer, query });
  expect(await resolve('cdn.example')).toEqual(publicAnswer);
  expect(query.mock.calls[0][1]).toMatchObject({ endpoint: 'https://cloudflare-dns.com/dns-query', bootstrap: ['1.1.1.1', '1.0.0.1'] });
  expect(query.mock.calls[1][1]).toMatchObject({ endpoint: 'https://dns.google/resolve', bootstrap: ['8.8.8.8', '8.8.4.4'] });
});

it('does not cache zero-TTL answers or retain more than 64 fallback hosts', async () => {
  const query = jest.fn(async () => ({ addresses: publicAnswer, ttl: 0 }));
  const resolve = createPublicDnsResolver({ system: async () => fakeAnswer, query });
  await resolve('zero.example'); await resolve('zero.example');
  expect(query).toHaveBeenCalledTimes(2);
  query.mockImplementation(async () => ({ addresses: publicAnswer, ttl: 60 }));
  for (let index = 0; index < 65; index++) await resolve(`${index}.example`);
  await resolve('0.example');
  expect(query).toHaveBeenCalledTimes(68);
});

it('stops fallback work when a request is cancelled', async () => {
  const controller = new AbortController();
  const query = jest.fn(async () => {
    controller.abort(new Error('cancelled'));
    throw new Error('aborted');
  });
  const resolve = createPublicDnsResolver({ system: async () => fakeAnswer, query });
  await expect(resolve('cdn.example', controller.signal)).rejects.toThrow('cancelled');
  expect(query).toHaveBeenCalledTimes(1);
});
