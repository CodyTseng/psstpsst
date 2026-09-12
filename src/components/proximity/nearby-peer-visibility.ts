import type { NearbyDiscovery, NearbyPeer } from '@/services/proximity/proximity-session';

export type VisibleNearbyPeer = NearbyPeer & {
  signalFresh: boolean;
  relationshipStatus: 'unlinked' | 'trusted';
};

type StoredNearbyPeer = {
  proximityPubkey: string;
  nickname: string | null;
  connectedAt: number | null;
  blockedAt: number | null;
};

/**
 * Builds the Nearby screen rows from fresh radio discoveries plus trusted,
 * authenticated connections. A live connection keeps its row visible when a
 * platform stops reporting advertisements for the reverse BLE role, but it
 * never manufactures a radio signal or keeps an untrusted peer visible. Rows
 * rank fresh signals by coarse proximity tier, retaining session insertion
 * order inside each tier. Signal smoothing and tier hysteresis happen in the
 * discovery service so normal radio noise cannot move a press target.
 */
export function buildVisibleNearbyPeers(
  discoveries: Readonly<Record<string, NearbyDiscovery>>,
  sessionPeers: Readonly<Record<string, NearbyPeer>>,
  storedPeersByPubkey: ReadonlyMap<string, StoredNearbyPeer>,
): VisibleNearbyPeer[] {
  const strong: VisibleNearbyPeer[] = [];
  const medium: VisibleNearbyPeer[] = [];
  const weak: VisibleNearbyPeer[] = [];
  const unavailable: VisibleNearbyPeer[] = [];

  for (const peer of Object.values(sessionPeers)) {
    const storedPeer = storedPeersByPubkey.get(peer.proximityPubkey);
    if (storedPeer?.blockedAt != null) continue;
    const discovery = discoveries[peer.proximityPubkey];
    if (discovery) {
      const visiblePeer: VisibleNearbyPeer = {
        ...peer,
        displayName: storedPeer?.nickname || peer.displayName,
        rssi: discovery.rssi,
        lastSeenAt: discovery.lastSeenAt,
        signalFresh: discovery.signalFresh,
        relationshipStatus: storedPeer?.connectedAt != null ? 'trusted' : 'unlinked',
      };
      if (!discovery.signalFresh) {
        unavailable.push(visiblePeer);
      } else if (discovery.signalTier === 'strong') {
        strong.push(visiblePeer);
      } else if (discovery.signalTier === 'medium') {
        medium.push(visiblePeer);
      } else {
        weak.push(visiblePeer);
      }
      continue;
    }
    if (peer.connectionStatus !== 'connected') continue;
    if (storedPeer?.connectedAt == null) continue;
    unavailable.push({
      ...peer,
      displayName: storedPeer.nickname || peer.displayName,
      rssi: 0,
      signalFresh: false,
      relationshipStatus: 'trusted',
    });
  }

  return [...strong, ...medium, ...weak, ...unavailable];
}
