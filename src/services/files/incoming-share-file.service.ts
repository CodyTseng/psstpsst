import { platform } from "@/platform";
import type { IncomingShareItem } from "@/lib/share/incoming-share";

import { extFromName, mimeToExt } from "./attachment-store";

async function incomingShareDir(): Promise<string> {
  const base = await platform.fileSystem.cacheDirectoryUri();
  if (!base) throw new Error("FileSystem.cacheDirectory unavailable");
  return `${base}psstpsst-incoming-share/`;
}

/**
 * Copy OS-owned attachment URIs into app-owned cache before clearing the native
 * share payload. Copies run sequentially to avoid competing reads of large files.
 */
export async function stageIncomingShare(
  items: IncomingShareItem[],
): Promise<{ items: IncomingShareItem[]; cleanup: () => Promise<void> }> {
  const copiedUris: string[] = [];
  const staged: IncomingShareItem[] = [];

  await platform.fileSystem
    .makeDirectory(await incomingShareDir(), { intermediates: true })
    .catch(() => {});

  try {
    for (const item of items) {
      if (item.kind === "text") {
        staged.push(item);
        continue;
      }

      const namedExt = extFromName(item.name);
      const extension = namedExt ? `.${namedExt}` : mimeToExt(item.mime);
      const shareDir = await incomingShareDir();
      const localUri = `${shareDir}${await platform.deviceCrypto.randomUUID()}${extension}`;
      await platform.fileSystem.copy(item.localUri, localUri);
      copiedUris.push(localUri);
      staged.push({ ...item, localUri });
    }
  } catch (error) {
    await Promise.all(
      copiedUris.map((uri) =>
        platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {}),
      ),
    );
    throw error;
  }

  return {
    items: staged,
    cleanup: async () => {
      await Promise.all(
        copiedUris.map((uri) =>
          platform.fileSystem.delete(uri, { idempotent: true }).catch(() => {}),
        ),
      );
    },
  };
}
