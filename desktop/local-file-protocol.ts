/** Add CORS only for the application renderer, retaining the file's streaming body. */
export function localFileResponse(
  request: Request & { initiatorOrigin?: string },
  response: Response,
  isTrustedOrigin: (origin: string) => boolean,
  rendererOrigin?: string,
): Response {
  const headers = new Headers(response.headers);
  // Never inherit a permissive file-response policy for private application files.
  headers.delete('Access-Control-Allow-Origin');
  // Some Electron versions omit both fields for custom-scheme media loads.
  // A fixed renderer origin is still restrictive: other browser origins do not match it.
  const origin = request.headers.get('Origin') ?? request.initiatorOrigin ?? rendererOrigin;
  if (origin && isTrustedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range');
    headers.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range');
  }
  headers.append('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
