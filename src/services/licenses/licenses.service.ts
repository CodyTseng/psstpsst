import { platform } from '@/platform';

export type LicenseDocument = { id: string; title: string };
export type LicensedProject = {
  id: string;
  name: string;
  version?: string;
  license: string;
  repository?: string;
  website?: string;
  documents: LicenseDocument[];
};
export type NoticeChunk = { key: string; title?: string; text: string };
export type LicenseCatalog = {
  projects: readonly LicensedProject[];
  byId: ReadonlyMap<string, LicensedProject>;
  search: ReadonlyMap<string, string>;
};

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
let catalogPromise: Promise<LicenseCatalog> | undefined;

/** Loading the small metadata index is deferred until this feature is opened. */
export function loadLicenseCatalog(): Promise<LicenseCatalog> {
  return catalogPromise ??= (async () => {
    await yieldToUI();
    // A static require keeps Metro's native release bundle fully offline.
    const projects: LicensedProject[] = require('@/generated/licenses/catalog.json');
    return {
      projects,
      byId: new Map(projects.map((project) => [project.id, project])),
      search: new Map(projects.map((project) => [project.id,
        `${project.name} ${project.version ?? ''} ${project.license}`.toLowerCase()])),
    };
  })().catch((error: unknown) => {
    catalogPromise = undefined;
    throw error;
  });
}

export function searchLicensedProjects(catalog: LicenseCatalog, query: string): readonly LicensedProject[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.length === 0 ? catalog.projects : catalog.projects.filter((project) => {
    const haystack = catalog.search.get(project.id)!;
    return terms.every((term) => haystack.includes(term));
  });
}

/** Bounded text nodes avoid expensive native layout for large bundled collections.
 * Preserve every character, including original notices and copyright statements. */
export async function splitNoticeText(text: string): Promise<string[]> {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 3000, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline > offset) end = newline + 1;
      else if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
    if (chunks.length % 24 === 0) await yieldToUI();
  }
  return chunks;
}

const cache = new Map<string, readonly string[]>();
const pending = new Map<string, Promise<readonly string[]>>();
let cachedCharacters = 0;
const MAX_CACHED_CHARACTERS = 500_000;

function loadDocument(id: string): Promise<readonly string[]> {
  const cached = cache.get(id);
  if (cached) {
    cache.delete(id);
    cache.set(id, cached);
    return Promise.resolve(cached);
  }
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const task = (async () => {
    await yieldToUI();
    const text = await platform.bundledNotices.readText(id);
    await yieldToUI();
    const chunks = await splitNoticeText(text);
    if (text.length <= MAX_CACHED_CHARACTERS) {
      while (cache.size && cachedCharacters + text.length > MAX_CACHED_CHARACTERS) {
        const oldest = cache.keys().next().value!;
        cachedCharacters -= cache.get(oldest)!.reduce((total, chunk) => total + chunk.length, 0);
        cache.delete(oldest);
      }
      cache.set(id, chunks);
      cachedCharacters += text.length;
    }
    return chunks;
  })().finally(() => pending.delete(id));
  pending.set(id, task);
  return task;
}

export async function loadProjectNotices(project: LicensedProject): Promise<readonly NoticeChunk[]> {
  const chunks: NoticeChunk[] = [];
  // Sequential loading bounds temporary memory even for packages with many notices.
  for (const [fileIndex, doc] of project.documents.entries()) {
    const parts = await loadDocument(doc.id);
    for (const [index, text] of parts.entries()) {
      chunks.push({ key: `${fileIndex}:${index}`, title: index === 0 ? doc.title : undefined, text });
    }
  }
  return chunks;
}

export async function openProjectUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Unsupported project URL');
  }
  await platform.urlOpener.openExternalUrl(parsed.href);
}

export function openRuntimeNotices(): Promise<void> {
  return platform.bundledNotices.openRuntimeNotices();
}
