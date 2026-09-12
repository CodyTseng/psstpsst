export const PROXIMITY_PROTOCOL_VERSION = 1;
export const PROXIMITY_MAX_PROFILE_LENGTH = 16 * 1024;
export const PROXIMITY_MAX_PAYLOAD_LENGTH = 128 * 1024;

export const PROXIMITY_EVENT_NAMES = [
  'onPeer',
  'onSignal',
  'onMessage',
  'onConnection',
  'onBluetoothState',
] as const;

export type ProximityEventName = (typeof PROXIMITY_EVENT_NAMES)[number];

export type NativeProximityHandshake = {
  protocolVersion: number;
  implementationVersion: string;
  platform: NodeJS.Platform;
  capabilities: {
    central: boolean;
    peripheral: boolean;
    concurrentRoles: boolean;
  };
};

export type NativeProximityRequest = {
  id: string;
  command: string;
  args: Record<string, unknown>;
};

export type NativeProximityEvent = {
  type: 'event';
  name: ProximityEventName;
  value: Record<string, unknown>;
};

export type NativeProximityResponse = {
  type: 'response';
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

export type NativeProximityMessage =
  NativeProximityEvent | NativeProximityResponse;

const eventNames = new Set<string>(PROXIMITY_EVENT_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseNativeProximityMessage(
  line: string,
): NativeProximityMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.type === 'event') {
    if (
      typeof value.name !== 'string' ||
      !eventNames.has(value.name) ||
      !isRecord(value.value)
    ) {
      return null;
    }
    return value as NativeProximityEvent;
  }
  if (
    value.type !== 'response' ||
    typeof value.id !== 'string' ||
    typeof value.ok !== 'boolean' ||
    (value.error !== undefined && typeof value.error !== 'string')
  ) {
    return null;
  }
  return value as NativeProximityResponse;
}

export function validateNativeProximityHandshake(
  value: unknown,
  expectedPlatform: NodeJS.Platform,
): NativeProximityHandshake {
  if (!isRecord(value) || !isRecord(value.capabilities)) {
    throw new Error(
      'The native proximity module returned an invalid handshake',
    );
  }
  const handshake = value as NativeProximityHandshake;
  if (handshake.protocolVersion !== PROXIMITY_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported native proximity protocol version: ${String(handshake.protocolVersion)}`,
    );
  }
  if (
    typeof handshake.implementationVersion !== 'string' ||
    handshake.implementationVersion.length === 0 ||
    handshake.platform !== expectedPlatform ||
    handshake.capabilities.central !== true ||
    handshake.capabilities.peripheral !== true ||
    handshake.capabilities.concurrentRoles !== true
  ) {
    throw new Error(
      'The native proximity module does not support the required BLE roles',
    );
  }
  return handshake;
}
