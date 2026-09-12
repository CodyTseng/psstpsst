/**
 * Structural mirrors of expo-sharing's incoming-share payloads, defined locally
 * so this core-layer module stays platform-free (see docs/ARCHITECTURE.md §2). The
 * UI layer (`components/share/IncomingShareForwardScreen.tsx`) feeds in
 * expo-sharing's own values, which
 * are structurally compatible with these shapes.
 */
export type IncomingShareType = "text" | "url" | "audio" | "image" | "video" | "file";

export type IncomingShareContentType = IncomingShareType | "website";

/** Raw payload as handed to the app (expo-sharing's `SharePayload`). */
export type IncomingSharePayload = {
  value: string;
  shareType?: IncomingShareType;
  mimeType?: string;
};

/** Payload with OS-resolved file metadata (expo-sharing's `ResolvedSharePayload`). */
export type ResolvedIncomingSharePayload = IncomingSharePayload & {
  contentUri?: string | null;
  contentType?: IncomingShareContentType | null;
  contentMimeType?: string | null;
  originalName?: string | null;
  contentSize?: number | null;
};

export const MAX_INCOMING_SHARE_ITEMS = 10;

export type IncomingShareText = {
  kind: "text";
  id: string;
  content: string;
};

export type IncomingShareFile = {
  kind: "file";
  id: string;
  localUri: string;
  mime: string;
  name?: string;
  size?: number;
};

export type IncomingShareItem = IncomingShareText | IncomingShareFile;

function fallbackMime(type: IncomingShareType | undefined): string {
  if (type === "image") return "image/*";
  if (type === "video") return "video/*";
  if (type === "audio") return "audio/*";
  return "application/octet-stream";
}

function fallbackName(uri: string): string | undefined {
  const withoutQuery = uri.split(/[?#]/, 1)[0];
  const segment = withoutQuery.split("/").pop();
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isResolvedPayload(
  payload: IncomingSharePayload | ResolvedIncomingSharePayload,
): payload is ResolvedIncomingSharePayload {
  return "contentUri" in payload;
}

/**
 * Normalize Expo's raw/resolved payload pair into the two things PsstPsst sends:
 * plain messages and local attachment URIs. The raw array is available on the
 * first render; resolved entries progressively add reliable file metadata.
 */
export function normalizeIncomingShare(
  sharedPayloads: IncomingSharePayload[],
  resolvedSharedPayloads: ResolvedIncomingSharePayload[],
): IncomingShareItem[] {
  const seen = new Set<string>();
  const items: IncomingShareItem[] = [];

  sharedPayloads.forEach((raw, index) => {
    const payload = resolvedSharedPayloads[index] ?? raw;
    const resolved = isResolvedPayload(payload) ? payload : null;
    const shareType = payload.shareType ?? "text";
    const contentType = resolved?.contentType;

    if (
      shareType === "text" ||
      shareType === "url" ||
      contentType === "text" ||
      contentType === "website"
    ) {
      const content = (payload.value || resolved?.contentUri || "").trim();
      if (!content) return;
      const key = `text\n${content}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ kind: "text", id: `incoming-${index}`, content });
      return;
    }

    const localUri = resolved?.contentUri || payload.value || "";
    if (!localUri) return;
    const mime =
      resolved?.contentMimeType || payload.mimeType || fallbackMime(shareType);
    const name = resolved?.originalName || fallbackName(localUri);
    const key = `file\n${localUri}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      kind: "file",
      id: `incoming-${index}`,
      localUri,
      mime,
      name: name ?? undefined,
      size: resolved?.contentSize ?? undefined,
    });
  });

  return items;
}
