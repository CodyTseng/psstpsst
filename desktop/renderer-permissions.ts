/** Invoked only after the requesting renderer has passed the caller's trust checks. */
export function isAllowedRendererPermission(permission: string): boolean {
  return permission === 'media' || permission === 'notifications' || permission === 'fullscreen';
}
