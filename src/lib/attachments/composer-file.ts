import { platform } from '@/platform';

/** A browser-owned file carried by Electron's clipboard or drag-and-drop APIs. */
export type BrowserFile = Blob & {
  readonly name?: string;
  readonly type: string;
  readonly size: number;
};

/** A browser or native drop normalized for the chat attachment confirmation flow. */
export type ComposerFile = {
  /** Clipboard image payloads do not always include a filename. */
  name?: string;
  mime: string;
  size: number;
  /** Intrinsic media dimensions captured by the confirmation preview. */
  width?: number;
  height?: number;
} & (
  | { file: BrowserFile; uri?: never; temporary?: never }
  | { file?: never; uri: string; temporary: true }
);

export type ComposerMediaKind = 'image' | 'video' | 'audio';

const MEDIA_EXTENSIONS: Record<ComposerMediaKind, ReadonlySet<string>> = {
  image: new Set([
    'avif',
    'bmp',
    'gif',
    'heic',
    'heif',
    'jpeg',
    'jpg',
    'png',
    'svg',
    'tif',
    'tiff',
    'webp',
  ]),
  video: new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']),
  audio: new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav']),
};

/** Classify visual/audio media even when the browser omits the MIME type. */
export function composerMediaKind(
  file: Pick<ComposerFile, 'mime' | 'name'>,
): ComposerMediaKind | null {
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (file.mime.startsWith(`${kind}/`)) return kind;
  }
  const extension = file.name?.split('.').pop()?.toLowerCase();
  if (!extension) return null;
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (MEDIA_EXTENSIONS[kind].has(extension)) return kind;
  }
  return null;
}

export function areAllComposerFilesMedia(files: readonly ComposerFile[]): boolean {
  return files.length > 0 && files.every((file) => composerMediaKind(file) != null);
}

type FileItem = {
  kind?: string;
  getAsFile?: () => BrowserFile | null;
  webkitGetAsEntry?: () =>
    | {
        isFile?: boolean;
        isDirectory?: boolean;
      }
    | null;
};

type FileCarrier = {
  files?: ArrayLike<BrowserFile>;
  items?: ArrayLike<FileItem>;
  types?: ArrayLike<string>;
};

type PasteEvent = {
  clipboardData?: FileCarrier | null;
};

function toComposerFile(file: BrowserFile): ComposerFile {
  return {
    file,
    name: file.name || undefined,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  };
}

function filesFromItems(items: readonly FileItem[]): ComposerFile[] {
  return items.flatMap((item) => {
    if (item.kind !== 'file') return [];
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory === true || entry?.isFile === false) return [];
    const file = item.getAsFile?.();
    return file ? [toComposerFile(file)] : [];
  });
}

/**
 * Extract file payloads without touching ordinary text paste. Chromium exposes
 * copied files through `files` in most cases, with `items` as the fallback for
 * copied images from other applications.
 */
export function composerFilesFromClipboard(event: unknown): ComposerFile[] {
  const data = (event as PasteEvent | null)?.clipboardData;
  if (!data) return [];

  const files = data.files ? Array.from(data.files) : [];
  if (files.length > 0) return files.map(toComposerFile);

  const items = data.items ? Array.from(data.items) : [];
  return filesFromItems(items);
}

/** Cheap drag-hover probe; the actual file objects may be hidden until drop. */
export function dataTransferHasFiles(data: unknown): boolean {
  const carrier = data as FileCarrier | null;
  if (!carrier) return false;
  if (carrier.types && Array.from(carrier.types).includes('Files')) return true;
  if (carrier.files && carrier.files.length > 0) return true;
  return carrier.items
    ? Array.from(carrier.items).some((item) => item.kind === 'file')
    : false;
}

/**
 * Extract ordinary files from a drop. File-system directories are ignored;
 * Chromium exposes them as file items too, but they cannot enter the attachment
 * upload lifecycle as a single Blob.
 */
export function composerFilesFromDataTransfer(data: unknown): ComposerFile[] {
  const carrier = data as FileCarrier | null;
  if (!carrier) return [];

  const items = carrier.items ? Array.from(carrier.items) : [];
  const itemFiles = filesFromItems(items);
  if (itemFiles.length > 0) return itemFiles;
  if (
    items.some((item) => {
      const entry = item.webkitGetAsEntry?.();
      return entry?.isDirectory === true || entry?.isFile === false;
    })
  ) {
    return [];
  }

  const files = carrier.files ? Array.from(carrier.files) : [];
  return files.map(toComposerFile);
}

/** Release app-owned native drop copies after staging or cancellation. */
export function discardTemporaryComposerFiles(files: readonly ComposerFile[]): void {
  for (const file of files) {
    if (!file.uri || !file.temporary) continue;
    void platform.fileSystem.delete(file.uri, { idempotent: true }).catch(() => {
      // Cache cleanup must not replace the user's current action.
    });
  }
}
