import { parseBlossomUri } from '@/lib/nostr/blossom-uri';
import { findFileMeta, type FileAttachmentMeta } from '@/lib/nostr/file-tags';

export type NearbyFileOffer = FileAttachmentMeta & {
  mime: string;
  plainSha256Hex: string;
  size: number;
  plainSize: number;
};

function requiredTag(tags: string[][], name: string): string | null {
  const matches = tags.filter((tag) => tag[0] === name && tag.length >= 2);
  return matches.length === 1 ? matches[0][1] : null;
}

export function parseNearbyFileOffer(content: string, tags: string[][]): NearbyFileOffer | null {
  const meta = findFileMeta(content, tags);
  const manifest = parseBlossomUri(content.trim());
  const mime = requiredTag(tags, 'file-type');
  const algorithm = requiredTag(tags, 'encryption-algorithm');
  const key = requiredTag(tags, 'decryption-key');
  const nonce = requiredTag(tags, 'decryption-nonce');
  const x = requiredTag(tags, 'x');
  const ox = requiredTag(tags, 'ox');
  const cipherSizeText = requiredTag(tags, 'size');
  const plainSizeText = requiredTag(tags, 'plain-size');
  if (
    !meta ||
    !manifest ||
    manifest.extension !== '.bin' ||
    manifest.servers.length === 0 ||
    !mime ||
    algorithm !== 'aes-gcm' ||
    !key ||
    !/^[0-9a-f]{64}$/.test(key) ||
    !nonce ||
    !/^[0-9a-f]{24}$/.test(nonce) ||
    !x ||
    !/^[0-9a-f]{64}$/.test(x) ||
    !ox ||
    !/^[0-9a-f]{64}$/.test(ox) ||
    manifest.sha256 !== x ||
    !cipherSizeText ||
    !/^(0|[1-9]\d*)$/.test(cipherSizeText) ||
    !plainSizeText ||
    !/^(0|[1-9]\d*)$/.test(plainSizeText)
  ) {
    return null;
  }
  const size = Number(cipherSizeText);
  const plainSize = Number(plainSizeText);
  if (
    !Number.isSafeInteger(size) ||
    !Number.isSafeInteger(plainSize) ||
    size !== plainSize + 16 ||
    (manifest.size != null && manifest.size !== size)
  ) {
    return null;
  }
  return {
    ...meta,
    mime,
    cipherSha256Hex: x,
    plainSha256Hex: ox,
    size,
    plainSize,
    decryptionKeyHex: key,
    decryptionNonceHex: nonce,
  };
}
