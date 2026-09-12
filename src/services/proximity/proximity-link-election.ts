export type ProximityEndpointRole = 'central' | 'peripheral';

export function proximityEndpointRole(endpointId: string): ProximityEndpointRole | null {
  if (endpointId.startsWith('c:')) return 'central';
  if (endpointId.startsWith('p:')) return 'peripheral';
  return null;
}

/** The lower fixed public key keeps the Central side of the canonical BLE link. */
export function preferredProximityEndpointRole(
  localPubkey: string,
  peerPubkey: string,
): ProximityEndpointRole {
  return localPubkey < peerPubkey ? 'central' : 'peripheral';
}

/**
 * Pick one authenticated endpoint without relying on platform endpoint identifiers
 * matching between the Central and Peripheral roles. A current endpoint is sticky
 * within the preferred role so repeated discoveries cannot make the UI oscillate.
 */
export function selectCanonicalProximityEndpoint(
  localPubkey: string,
  peerPubkey: string,
  endpointIds: readonly string[],
  currentEndpoint?: string,
): string | null {
  if (endpointIds.length === 0) return null;
  const available = new Set(endpointIds);
  const preferredRole = preferredProximityEndpointRole(localPubkey, peerPubkey);
  if (
    currentEndpoint &&
    available.has(currentEndpoint) &&
    proximityEndpointRole(currentEndpoint) === preferredRole
  ) {
    return currentEndpoint;
  }
  const preferred = endpointIds.find(
    (endpointId) => proximityEndpointRole(endpointId) === preferredRole,
  );
  if (preferred) return preferred;
  return currentEndpoint && available.has(currentEndpoint)
    ? currentEndpoint
    : endpointIds[0];
}
