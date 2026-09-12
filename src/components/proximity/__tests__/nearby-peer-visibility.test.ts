import { buildVisibleNearbyPeers } from '@/components/proximity/nearby-peer-visibility';
import type { NearbyDiscovery, NearbyPeer } from '@/services/proximity/proximity-session';

function peer(
  proximityPubkey: string,
  connectionStatus: NearbyPeer['connectionStatus'],
): NearbyPeer {
  return {
    proximityPubkey,
    endpointId: `p:${proximityPubkey}`,
    displayName: proximityPubkey,
    rssi: -60,
    lastSeenAt: 100,
    deviceStatus: 'online',
    connectionStatus,
    connectionFailure: null,
  };
}

describe('Nearby peer visibility', () => {
  it('retains only trusted connected peers after their radio discovery expires', () => {
    const discoveredPeer = peer('discovered', 'disconnected');
    const connectedPeer = peer('connected', 'connected');
    const disconnectedPeer = peer('disconnected', 'disconnected');
    const untrustedPeer = peer('untrusted', 'connected');
    const blockedPeer = peer('blocked', 'connected');
    const discoveries: Record<string, NearbyDiscovery> = {
      discovered: {
        proximityPubkey: 'discovered',
        rssi: -40,
        lastSeenAt: 200,
        signalFresh: true,
        signalTier: 'strong',
      },
    };
    const storedPeers = new Map([
      [
        'connected',
        {
          proximityPubkey: 'connected',
          nickname: 'Connected nickname',
          connectedAt: 1,
          blockedAt: null,
        },
      ],
      [
        'disconnected',
        {
          proximityPubkey: 'disconnected',
          nickname: null,
          connectedAt: 1,
          blockedAt: null,
        },
      ],
      [
        'untrusted',
        {
          proximityPubkey: 'untrusted',
          nickname: null,
          connectedAt: null,
          blockedAt: null,
        },
      ],
      [
        'blocked',
        {
          proximityPubkey: 'blocked',
          nickname: null,
          connectedAt: 1,
          blockedAt: 2,
        },
      ],
    ]);

    const result = buildVisibleNearbyPeers(
      discoveries,
      {
        discovered: discoveredPeer,
        connected: connectedPeer,
        disconnected: disconnectedPeer,
        untrusted: untrustedPeer,
        blocked: blockedPeer,
      },
      storedPeers,
    );

    expect(result).toEqual([
      expect.objectContaining({
        proximityPubkey: 'discovered',
        rssi: -40,
        signalFresh: true,
        relationshipStatus: 'unlinked',
      }),
      expect.objectContaining({
        proximityPubkey: 'connected',
        displayName: 'Connected nickname',
        rssi: 0,
        signalFresh: false,
        relationshipStatus: 'trusted',
        connectionStatus: 'connected',
      }),
    ]);
  });

  it('does not duplicate a connected peer that still has a discovery', () => {
    const connectedPeer = peer('connected', 'connected');
    const result = buildVisibleNearbyPeers(
      {
        connected: {
          proximityPubkey: 'connected',
          rssi: -45,
          lastSeenAt: 200,
          signalFresh: true,
          signalTier: 'strong',
        },
      },
      { connected: connectedPeer },
      new Map([
        [
          'connected',
          {
            proximityPubkey: 'connected',
            nickname: null,
            connectedAt: 1,
            blockedAt: null,
          },
        ],
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rssi: -45, signalFresh: true });
  });

  it('ranks both sections by signal tier while preserving order inside a tier', () => {
    const sessionPeers = {
      'known-first': peer('known-first', 'connected'),
      'nearby-first': peer('nearby-first', 'disconnected'),
      'known-second': peer('known-second', 'connected'),
      'nearby-second': peer('nearby-second', 'disconnected'),
    };
    const storedPeers = new Map([
      [
        'known-first',
        {
          proximityPubkey: 'known-first',
          nickname: null,
          connectedAt: 1,
          blockedAt: null,
        },
      ],
      [
        'known-second',
        {
          proximityPubkey: 'known-second',
          nickname: null,
          connectedAt: 1,
          blockedAt: null,
        },
      ],
    ]);
    const initial = buildVisibleNearbyPeers(
      {
        'nearby-second': {
          proximityPubkey: 'nearby-second',
          rssi: -30,
          lastSeenAt: 200,
          signalFresh: true,
          signalTier: 'strong',
        },
        'known-second': {
          proximityPubkey: 'known-second',
          rssi: -40,
          lastSeenAt: 200,
          signalFresh: true,
          signalTier: 'strong',
        },
        'nearby-first': {
          proximityPubkey: 'nearby-first',
          rssi: -80,
          lastSeenAt: 200,
          signalFresh: true,
          signalTier: 'weak',
        },
        'known-first': {
          proximityPubkey: 'known-first',
          rssi: -90,
          lastSeenAt: 200,
          signalFresh: true,
          signalTier: 'weak',
        },
      },
      sessionPeers,
      storedPeers,
    );
    const updated = buildVisibleNearbyPeers(
      {
        'known-first': {
          proximityPubkey: 'known-first',
          rssi: -85,
          lastSeenAt: 210,
          signalFresh: true,
          signalTier: 'weak',
        },
        'nearby-first': {
          proximityPubkey: 'nearby-first',
          rssi: -95,
          lastSeenAt: 210,
          signalFresh: true,
          signalTier: 'weak',
        },
        'known-second': {
          proximityPubkey: 'known-second',
          rssi: -35,
          lastSeenAt: 210,
          signalFresh: true,
          signalTier: 'strong',
        },
        'nearby-second': {
          proximityPubkey: 'nearby-second',
          rssi: -25,
          lastSeenAt: 210,
          signalFresh: true,
          signalTier: 'strong',
        },
      },
      sessionPeers,
      storedPeers,
    );

    const sectionKeys = (rows: ReturnType<typeof buildVisibleNearbyPeers>) => ({
      known: rows
        .filter((row) => row.relationshipStatus === 'trusted')
        .map((row) => row.proximityPubkey),
      nearby: rows
        .filter((row) => row.relationshipStatus === 'unlinked')
        .map((row) => row.proximityPubkey),
    });
    expect(sectionKeys(initial)).toEqual({
      known: ['known-second', 'known-first'],
      nearby: ['nearby-second', 'nearby-first'],
    });
    expect(sectionKeys(updated)).toEqual(sectionKeys(initial));
  });

  it('places a newly discovered stronger device ahead of weaker devices', () => {
    const result = buildVisibleNearbyPeers(
      {
        existing: {
          proximityPubkey: 'existing',
          rssi: -82,
          lastSeenAt: 200,
          signalFresh: true,
          signalTier: 'weak',
        },
        new: {
          proximityPubkey: 'new',
          rssi: -42,
          lastSeenAt: 210,
          signalFresh: true,
          signalTier: 'strong',
        },
      },
      {
        existing: peer('existing', 'disconnected'),
        new: peer('new', 'disconnected'),
      },
      new Map(),
    );

    expect(result.map((row) => row.proximityPubkey)).toEqual(['new', 'existing']);
  });
});
