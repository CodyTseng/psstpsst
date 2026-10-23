/** NIP-01 ordering for one replaceable coordinate; IDs break equal-timestamp ties. */
export function isNewerEvent(incoming: { created_at: number; id: string }, current: { created_at: number; id: string }): boolean {
  return incoming.created_at > current.created_at || incoming.created_at === current.created_at && incoming.id < current.id;
}
