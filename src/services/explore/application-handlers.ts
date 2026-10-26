import { FAVORITES_PAGE_SIZE, type ExploreEntry } from './model';
import { readFavoriteMetadata, readFavoriteReferences } from './repository';

/** Favorites own handler membership; neither installations nor live endpoints grant it. */
export async function readApplicationHandlers(account: string, kind: 'napp' | 'napplet'): Promise<ExploreEntry[]> {
  const references = (await readFavoriteReferences(account)).filter(entry => entry.kind === kind);
  const result: ExploreEntry[] = [];
  for (let offset = 0; offset < references.length; offset += FAVORITES_PAGE_SIZE) {
    result.push(...await readFavoriteMetadata(account, references.slice(offset, offset + FAVORITES_PAGE_SIZE)));
  }
  return result;
}
