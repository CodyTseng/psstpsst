/** Local paths are URL names, not OS paths; bytes are stored under generated hash names. */
export function localInstallPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 512 || value.startsWith('//') || /[:%?#\\\u0000-\u001f\u007f]/.test(value)) throw new Error('invalid-install-path');
  const path = value.startsWith('/') ? value : `/${value}`;
  if (path === '/' || path.includes('//') || path.endsWith('/') ||
    path.split('/').some(segment => ['.', '..', '__policy__', '__psst__'].includes(segment)) ||
    decodeURIComponent(new URL(path, 'https://local.invalid').pathname) !== path) throw new Error('invalid-install-path');
  return path;
}
