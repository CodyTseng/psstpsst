import { getEventHash, validateEvent } from 'nostr-tools';

import type { Rumor } from '@/db/schema/types';
import { normalizeProximityDisplayName } from '@/services/proximity/proximity-display-name';

export const CHAT_ARCHIVE_FORMAT = 'psstpsst-chat-archive';
export const CHAT_ARCHIVE_VERSION = 2;

export const ARCHIVE_MANIFEST = 'manifest.json';
export const ARCHIVE_MESSAGES = 'messages.ndjson';

export type BackupImportKind = 'archive' | 'messages';

/** Classify only the file extensions accepted by chat-history import. */
export function backupImportKind(filename: string): BackupImportKind | null {
  const normalized = filename.trim().toLowerCase();
  if (normalized.endsWith('.zip')) return 'archive';
  if (normalized.endsWith('.jsonl') || normalized.endsWith('.ndjson')) return 'messages';
  return null;
}
export const ARCHIVE_ATTACHMENTS = 'attachments.ndjson';
export const ARCHIVE_PROXIMITY_DIRECTORY = 'proximity';
export const ARCHIVE_PROXIMITY_PEERS = `${ARCHIVE_PROXIMITY_DIRECTORY}/peers.ndjson`;

const HEX_64 = /^[0-9a-f]{64}$/;

export type ChatArchiveManifest = {
  format: typeof CHAT_ARCHIVE_FORMAT;
  version: 1 | typeof CHAT_ARCHIVE_VERSION;
  createdAt: string;
  accountPubkey: string;
  counts: {
    /** Relay messages stored in the root `messages.ndjson`. */
    messages: number;
    proximityMessages: number;
    proximityIdentities: number;
    proximityPeers: number;
    attachments: number;
  };
  sizes: {
    attachments: number;
  };
};

/** Device-local peer labels are restored without restoring connection consent
 * or block state. */
export type ChatArchiveProximityPeer = {
  pubkey: string;
  displayName: string;
  nickname: string | null;
  lastSeenAt: number;
};

/** One included remote URL -> one content-addressed archive blob. Records are
 * sorted by `sha256`, then `url`, so import can restore each large file once
 * while streaming an arbitrarily large URL index. */
export type ChatArchiveAttachment = {
  url: string;
  sha256: string;
  mime: string;
  size: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function createChatArchiveManifest(input: {
  accountPubkey: string;
  messages: number;
  proximityMessages: number;
  proximityIdentities: number;
  proximityPeers: number;
  attachments: number;
  attachmentBytes: number;
}): ChatArchiveManifest {
  return {
    format: CHAT_ARCHIVE_FORMAT,
    version: CHAT_ARCHIVE_VERSION,
    createdAt: new Date().toISOString(),
    accountPubkey: input.accountPubkey,
    counts: {
      messages: input.messages,
      proximityMessages: input.proximityMessages,
      proximityIdentities: input.proximityIdentities,
      proximityPeers: input.proximityPeers,
      attachments: input.attachments,
    },
    sizes: {
      attachments: input.attachmentBytes,
    },
  };
}

export function parseChatArchiveManifest(value: unknown): ChatArchiveManifest | null {
  if (!isRecord(value) || !isRecord(value.counts) || !isRecord(value.sizes)) return null;
  if (
    value.format !== CHAT_ARCHIVE_FORMAT ||
    (value.version !== 1 && value.version !== CHAT_ARCHIVE_VERSION)
  ) {
    return null;
  }
  if (
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.accountPubkey !== 'string' ||
    !HEX_64.test(value.accountPubkey) ||
    !isCount(value.counts.messages) ||
    !isCount(value.counts.attachments) ||
    !isCount(value.sizes.attachments)
  ) {
    return null;
  }
  if (value.version === 1) {
    return {
      ...(value as Omit<ChatArchiveManifest, 'counts'>),
      version: 1,
      counts: {
        messages: value.counts.messages as number,
        proximityMessages: 0,
        proximityIdentities: 0,
        proximityPeers: 0,
        attachments: value.counts.attachments as number,
      },
    };
  }
  if (
    !isCount(value.counts.proximityMessages) ||
    !isCount(value.counts.proximityIdentities) ||
    !isCount(value.counts.proximityPeers) ||
    (value.counts.proximityIdentities as number) > (value.counts.proximityMessages as number) ||
    (value.counts.proximityMessages === 0) !== (value.counts.proximityIdentities === 0)
  ) {
    return null;
  }
  return value as ChatArchiveManifest;
}

export function archiveBlobPath(sha256: string): string {
  return `blobs/${sha256}`;
}

export function parseChatArchiveAttachment(value: unknown): ChatArchiveAttachment | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.url !== 'string' ||
    value.url.length === 0 ||
    value.url.length > 16_384 ||
    typeof value.sha256 !== 'string' ||
    !HEX_64.test(value.sha256) ||
    typeof value.mime !== 'string' ||
    value.mime.length === 0 ||
    value.mime.length > 255 ||
    !isCount(value.size)
  ) {
    return null;
  }
  return value as ChatArchiveAttachment;
}

export function parseChatArchiveProximityPeer(value: unknown): ChatArchiveProximityPeer | null {
  if (!isRecord(value)) return null;
  const displayName =
    typeof value.displayName === 'string' ? normalizeProximityDisplayName(value.displayName) : '';
  const nickname =
    typeof value.nickname === 'string'
      ? normalizeProximityDisplayName(value.nickname)
      : value.nickname === null
        ? null
        : undefined;
  if (
    typeof value.pubkey !== 'string' ||
    !HEX_64.test(value.pubkey) ||
    !displayName ||
    displayName !== value.displayName ||
    nickname === undefined ||
    (typeof value.nickname === 'string' && (!nickname || nickname !== value.nickname)) ||
    !isCount(value.lastSeenAt)
  ) {
    return null;
  }
  return {
    pubkey: value.pubkey,
    displayName,
    nickname,
    lastSeenAt: value.lastSeenAt,
  };
}

/** Strict enough to keep malformed/tampered standalone files out of the normal
 * message persistence path, while retaining the unsigned NIP-17 rumor shape. */
export function parseBackupRumor(value: unknown): Rumor | null {
  if (!isRecord(value) || !validateEvent(value)) return null;
  if (typeof value.id !== 'string' || !HEX_64.test(value.id)) return null;
  try {
    if (getEventHash(value) !== value.id) return null;
  } catch {
    return null;
  }
  return value as Rumor;
}
