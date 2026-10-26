import { readApplicationHandlers } from '../application-handlers';
import { readFavoriteMetadata, readFavoriteReferences } from '../repository';
import { FAVORITES_PAGE_SIZE, type ExploreEntry } from '../model';

jest.mock('../repository', () => ({
  readFavoriteReferences: jest.fn(),
  readFavoriteMetadata: jest.fn(async (_account: string, page: ExploreEntry[]) => page),
}));

const app = (key: string, kind: ExploreEntry['kind'] = 'napp'): ExploreEntry => ({
  key, address: key, title: key, kind, description: '', servers: [], required: [], desktopPosition: 0, lastUsedAt: null,
});

beforeEach(() => jest.clearAllMocks());

it('reads every favorite metadata page without admitting history or another format', async () => {
  const favorites = Array.from({ length: FAVORITES_PAGE_SIZE + 1 }, (_, index) => app(`app-${index}`));
  jest.mocked(readFavoriteReferences).mockResolvedValue([...favorites, app('napplet', 'napplet'), app('site', 'website')]);
  expect(await readApplicationHandlers('account', 'napp')).toEqual(favorites);
  expect(readFavoriteMetadata).toHaveBeenCalledTimes(2);
  expect(readFavoriteMetadata).toHaveBeenLastCalledWith('account', [favorites.at(-1)]);
});

it('reads current account membership again after removal and when accounts differ', async () => {
  jest.mocked(readFavoriteReferences).mockImplementation(async account => account === 'A' ? [app('saved', 'napplet')] : []);
  expect(await readApplicationHandlers('A', 'napplet')).toEqual([app('saved', 'napplet')]);
  expect(await readApplicationHandlers('B', 'napplet')).toEqual([]);
  jest.mocked(readFavoriteReferences).mockResolvedValue([]);
  expect(await readApplicationHandlers('A', 'napplet')).toEqual([]);
});
