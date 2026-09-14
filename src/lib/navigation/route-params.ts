import { parseEmojiSetCoordinate } from '@/lib/nostr/custom-emoji';

export type RouteParam = string | string[] | undefined;

const HEX_ID = /^[0-9a-f]{64}$/i;
const OPAQUE_ID = /^[a-zA-Z0-9._:-]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Accept exactly one already-decoded Expo Router parameter within a fixed bound. */
export function routeStringParam(
  value: RouteParam,
  maxLength: number,
): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return null;
  }
  return CONTROL_CHARACTERS.test(value) ? null : value;
}

export function routeHexIdParam(value: RouteParam): string | null {
  const parsed = routeStringParam(value, 64);
  return parsed && HEX_ID.test(parsed) ? parsed.toLowerCase() : null;
}

export function routeOpaqueIdParam(value: RouteParam, maxLength = 256): string | null {
  const parsed = routeStringParam(value, maxLength);
  return parsed && OPAQUE_ID.test(parsed) ? parsed : null;
}

export function routeEmojiCoordinateParam(value: RouteParam): string | null {
  const parsed = routeStringParam(value, 256);
  return parsed && parseEmojiSetCoordinate(parsed) ? parsed : null;
}

export function optionalRouteTextParam(
  value: RouteParam,
  maxLength: number,
): string | null | undefined {
  if (value === undefined || value === '') return undefined;
  return routeStringParam(value, maxLength);
}

export type ConversationRouteParams = {
  key: string;
  transport: 'relay' | 'proximity';
  name?: string;
};

export function parseConversationRouteParams(params: {
  key: RouteParam;
  transport?: RouteParam;
  name?: RouteParam;
}): ConversationRouteParams | null {
  const key = routeHexIdParam(params.key);
  if (!key) return null;
  const transportValue = params.transport;
  if (
    transportValue !== undefined &&
    transportValue !== 'relay' &&
    transportValue !== 'proximity'
  ) {
    return null;
  }
  const name = optionalRouteTextParam(params.name, 256);
  if (name === null) return null;
  return {
    key,
    transport: transportValue === 'proximity' ? 'proximity' : 'relay',
    ...(name === undefined ? {} : { name }),
  };
}
