import type { Rumor } from '@/db/schema/types';
import { firstGroupId } from './group-messaging';

export const DISAPPEAR_AFTER_TAG = 'disappear-after';
export const MESSAGE_EXPIRATION_TAG = 'expiration';
export const DISAPPEARING_DURATIONS = [2_419_200, 604800, 86400, 3600, 300, 30] as const;
export const MAX_EXPIRY_DURATION = 365 * 86400;
export const MESSAGE_EXPIRY_SETTINGS_KIND = 30078;
export const MESSAGE_EXPIRY_SETTINGS_D = 'psstpsst-message-expiry';

type DeliveryKind = 'relay' | 'proximity';

export function validExpiryDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_EXPIRY_DURATION;
}

export function messageExpiration(rumor: Pick<Rumor, 'kind' | 'tags'>, deliveryKind: DeliveryKind = 'relay'): number | null {
  if (![7, 14, 15].includes(rumor.kind) || rumor.tags.some(([key]) => key === 'action') ||
      (deliveryKind === 'relay' && firstGroupId(rumor.tags) !== null)) return null;
  const tag = rumor.tags.find(([key]) => key === MESSAGE_EXPIRATION_TAG);
  const seconds = tag?.[1];
  if (!seconds || !/^[0-9]+$/.test(seconds)) return null;
  const timestamp = Number(seconds);
  return timestamp <= 8_640_000_000_000 ? timestamp : null;
}

export function messageExpirationTag(createdAt: number, duration: number): string[] {
  return [MESSAGE_EXPIRATION_TAG, String(createdAt + duration)];
}

export function isDisappearingMessage(rumor: Pick<Rumor, 'kind' | 'tags'>, deliveryKind: DeliveryKind = 'relay'): boolean {
  return messageExpiration(rumor, deliveryKind) !== null ||
    (deliveryKind === 'relay' && disappearingMessageDuration(rumor) !== null);
}

export function messageExpiryFields(rumor: Pick<Rumor, 'kind' | 'tags' | 'created_at'>, deliveryKind: DeliveryKind = 'relay') {
  const deadline = messageExpiration(rumor, deliveryKind);
  return deadline === null ? { expiresAt: null, disappearAfterSeconds: null }
    : { expiresAt: deadline * 1000, disappearAfterSeconds: Math.max(1, deadline - rumor.created_at) };
}

export function isExpiredMessage(rumor: Pick<Rumor, 'kind' | 'tags'>, deliveryKind: DeliveryKind = 'relay', now = Date.now()): boolean {
  const deadline = messageExpiration(rumor, deliveryKind);
  return deadline !== null && deadline * 1000 <= now;
}

/** Read legacy messages from builds that encoded a relative timer. */
export function disappearingMessageDuration(rumor: Pick<Rumor, 'kind' | 'tags'>): number | null {
  if (rumor.kind !== 14 || rumor.tags.some(([key]) => key === 'h' || key === 'action')) return null;
  const tag = rumor.tags.find(([key]) => key === DISAPPEAR_AFTER_TAG);
  const seconds = tag?.[1];
  if (tag?.length !== 2 || !seconds || !/^[1-9][0-9]{0,5}$/.test(seconds)) return null;
  return Number(seconds) <= 604800 ? Number(seconds) : null;
}
