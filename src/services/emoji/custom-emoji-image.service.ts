import {
  isValidEmojiShortcode,
  normalizeEmojiShortcode,
  type CustomEmoji,
} from '@/lib/nostr/custom-emoji';
import { platform } from '@/platform';
import { buildSigner } from '@/services/account/account.service';
import { uploadPublicImage } from '@/services/files/blossom.service';
import { loadAccountMediaServers } from '@/services/files/media-server.service';

/** Upload bytes that already match the framing shown in the emoji editor. */
export async function uploadCustomEmojiImage(opts: {
  accountPubkey: string;
  shortcode: string;
  fileUri: string;
  mime: string;
  metadataStripped: boolean;
  preserveSourceBytes: boolean;
}): Promise<CustomEmoji> {
  const shortcode = normalizeEmojiShortcode(opts.shortcode);
  if (!isValidEmojiShortcode(shortcode)) {
    throw new Error('Invalid custom emoji shortcode.');
  }
  if (!opts.fileUri) {
    throw new Error('Custom emoji image has no local file path.');
  }
  // react-native-view-shot returns a raw POSIX path on iOS, while Expo
  // FileSystem requires a URL with an explicit file scheme.
  let fileUri = opts.fileUri.startsWith('/')
    ? `file://${opts.fileUri}`
    : opts.fileUri;

  let stagedUri: string | undefined;
  try {
    // Renderer-owned images must become real files before hashing and upload.
    // Preserve the original bytes here, including animated GIFs.
    if (fileUri.startsWith('data:') || fileUri.startsWith('blob:')) {
      const cache = await platform.fileSystem.cacheDirectoryUri();
      if (!cache) throw new Error('Custom emoji cache is unavailable.');
      stagedUri = `${cache}custom-emoji-${await platform.deviceCrypto.randomUUID()}`;
      await platform.fileSystem.copy(fileUri, stagedUri);
      fileUri = stagedUri;
    }

    const [signer, servers] = await Promise.all([
      buildSigner(opts.accountPubkey),
      loadAccountMediaServers(opts.accountPubkey),
    ]);
    const uploaded = await uploadPublicImage({
      signer,
      fileUri,
      mime: opts.mime,
      servers,
      authContent: 'Upload sticker',
      metadataStripped: opts.metadataStripped,
      preserveSourceBytes: opts.preserveSourceBytes,
    });
    return { shortcode, url: uploaded.url };
  } finally {
    if (stagedUri) {
      await platform.fileSystem.delete(stagedUri, { idempotent: true }).catch(() => {});
    }
  }
}
