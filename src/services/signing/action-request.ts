import type { SigningRequest, SigningScope } from './model';

export function isApplicationAction(scope: Pick<SigningScope, 'operation'>): boolean {
  return ['relay-auth', 'http-auth', 'upload'].includes(scope.operation);
}

/** Review the actual HTTP request without making its destination or method a grant key. */
function httpAuthTarget(tags: readonly string[][]): string {
  const targets = tags.filter(tag => tag[0] === 'u' || tag[0] === 'url');
  const methods = tags.filter(tag => tag[0] === 'method');
  if (targets.length !== 1 || methods.length !== 1 || targets[0].length !== 2 || methods[0].length !== 2 ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(methods[0][1])) throw new Error('invalid-http-auth');
  let target: URL;
  try { target = new URL(targets[0][1]); } catch { throw new Error('invalid-http-auth'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash)
    throw new Error('invalid-http-auth');
  return target.origin;
}

/** Authentication and uploads are app actions; target details stay in the review only. */
export function applicationActionRequest(request: SigningRequest): SigningRequest {
  if (request.operation === 'http-auth') {
    if (request.kind !== 27235) throw new Error('invalid-http-auth');
    return { ...request, relays: [httpAuthTarget(request.tags)], scopeKey: undefined };
  }
  if (request.operation === 'relay-auth') {
    const targets = request.tags.filter(tag => tag[0] === 'relay');
    if (targets.length > 1) throw new Error('invalid-auth');
    return { ...request, relays: targets.length ? [targets[0][1]] : request.relays, scopeKey: undefined };
  }
  return request;
}
