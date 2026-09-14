import { prepareBrandArtworkUri } from '../BrandArtworkImage';

const mockBundledDownload = jest.fn();
const mockMaterializedDownload = jest.fn();
const mockFromModule = jest.fn();
const mockFromUri = jest.fn();
const mockCacheDirectoryUri = jest.fn();
const mockStat = jest.fn();
const mockCopy = jest.fn();

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: (...args: unknown[]) => mockFromModule(...args),
    fromURI: (...args: unknown[]) => mockFromUri(...args),
  },
}));

jest.mock('expo-image', () => ({ Image: () => null }));

jest.mock('@/platform', () => ({
  platform: {
    fileSystem: {
      cacheDirectoryUri: (...args: unknown[]) => mockCacheDirectoryUri(...args),
      stat: (...args: unknown[]) => mockStat(...args),
      copy: (...args: unknown[]) => mockCopy(...args),
    },
  },
}));

it('materializes an Android drawable resource before copying it to the shared cache', async () => {
  const bundledAsset = {
    hash: 'artwork-hash',
    localUri: 'cats_at_sunset',
    uri: 'cats_at_sunset',
    downloadAsync: mockBundledDownload,
  };
  const materializedAsset = {
    hash: null,
    localUri: 'file:///expo-cache/ExponentAsset-artwork.png',
    uri: 'cats_at_sunset',
  };
  mockFromModule.mockReturnValue(bundledAsset);
  mockFromUri.mockReturnValue({ downloadAsync: mockMaterializedDownload });
  mockMaterializedDownload.mockResolvedValue(materializedAsset);
  mockCacheDirectoryUri.mockResolvedValue('file:///app-cache/');
  mockStat.mockResolvedValue({ exists: false });
  mockCopy.mockResolvedValue(undefined);

  await expect(prepareBrandArtworkUri()).resolves.toBe(
    'file:///app-cache/brand-artwork-artwork-hash.png',
  );
  expect(mockBundledDownload).not.toHaveBeenCalled();
  expect(mockFromUri).toHaveBeenCalledWith('cats_at_sunset');
  expect(mockCopy).toHaveBeenCalledWith(
    'file:///expo-cache/ExponentAsset-artwork.png',
    'file:///app-cache/brand-artwork-artwork-hash.png',
  );
});
