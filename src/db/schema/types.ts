import type { Event } from 'nostr-tools';

export type NostrEvent = Event;

/** A NIP-17 rumor: unsigned, no `sig`/`id` field has cryptographic meaning beyond identity. */
export type Rumor = Omit<Event, 'sig'> & { sig?: never };

/** Stored on outbox rows so failed sends can be re-published without rebuilding from inputs. */
export type PendingPublishPayload =
  | {
      version: 1;
      deliveryKind: 'relay';
      copies: {
        recipientPubkey: string;
        self: boolean;
        giftWrap: Event;
        relayUrls: string[];
      }[];
    }
  | {
      version: 1;
      deliveryKind: 'proximity';
      rumor: Rumor;
    };
