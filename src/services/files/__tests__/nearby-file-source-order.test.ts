import { fetchNearbyNetworkFirst } from '../nearby-file-source-order';

describe('Nearby file source preference', () => {
  it('uses the network without starting Bluetooth when Blossom succeeds', async () => {
    const order: string[] = [];
    const result = await fetchNearbyNetworkFirst({
      network: async () => {
        order.push('network');
        return 'remote-file';
      },
      bluetooth: async () => {
        order.push('bluetooth');
        return 'direct-file';
      },
    });

    expect(order).toEqual(['network']);
    expect(result).toEqual({ ok: true, source: 'network', value: 'remote-file' });
  });

  it('falls back to Bluetooth after a network failure', async () => {
    const order: string[] = [];
    const result = await fetchNearbyNetworkFirst({
      network: async () => {
        order.push('network');
        throw new Error('server unavailable');
      },
      bluetooth: async () => {
        order.push('bluetooth');
        return 'direct-file';
      },
    });

    expect(order).toEqual(['network', 'bluetooth']);
    expect(result).toEqual({ ok: true, source: 'bluetooth', value: 'direct-file' });
  });

  it('preserves a local pause while Bluetooth reports its own cancellation error', async () => {
    const controller = new AbortController();

    await expect(
      fetchNearbyNetworkFirst({
        signal: controller.signal,
        network: async () => {
          throw new Error('server unavailable');
        },
        bluetooth: async () => {
          controller.abort();
          throw new Error('Nearby file transfer stopped (6)');
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
