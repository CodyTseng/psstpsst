/** Packaged builds never load or trust renderer code supplied by the environment. */
export function resolveDevelopmentRendererOrigin(packaged: boolean, value?: string): string | null {
  if (packaged || !value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash) throw new Error('Unsupported Electron development renderer URL');
  return url.origin;
}
