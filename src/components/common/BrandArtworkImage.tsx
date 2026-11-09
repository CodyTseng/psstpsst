import { Asset } from 'expo-asset';
import { Image, type ImageProps } from 'expo-image';

import { platform } from '@/platform';

export type BrandArtworkVariant = 'sunset' | 'daylight';

type Props = Pick<ImageProps, 'contentPosition' | 'style'> & {
  variant?: BrandArtworkVariant;
};

const ARTWORK_SOURCES = {
  sunset: require('../../../assets/images/brand/cats-at-sunset.png'),
  daylight: require('../../../assets/images/brand/cats-at-summer-noon.png'),
};
const preparedArtworkUris: Partial<Record<BrandArtworkVariant, Promise<string>>> = {};

/** Stage the bundled artwork in the shared cache so the lightbox can also save it. */
export function prepareBrandArtworkUri(variant: BrandArtworkVariant = 'sunset'): Promise<string> {
  const prepared = preparedArtworkUris[variant];
  if (prepared) return prepared;
  const pending = (async () => {
    const bundledAsset = Asset.fromModule(ARTWORK_SOURCES[variant]);
    const bundledUri = bundledAsset.localUri ?? bundledAsset.uri;
    // Standalone Android builds resolve bundled images to a drawable resource
    // name and mark them as downloaded even though there is no readable file.
    // Recreate that resource as a URI asset so Expo copies it into its cache.
    const asset = await (bundledUri.includes(':')
      ? bundledAsset
      : Asset.fromURI(bundledUri)
    ).downloadAsync();
    const sourceUri = asset.localUri ?? asset.uri;
    const cacheDirectory = await platform.fileSystem.cacheDirectoryUri();
    if (!cacheDirectory) return sourceUri;

    const revision = bundledAsset.hash ?? 'v2';
    const destination = `${cacheDirectory}brand-artwork-${variant}-${revision}.png`;
    if (!(await platform.fileSystem.stat(destination)).exists) {
      await platform.fileSystem.copy(sourceUri, destination);
    }
    return destination;
  })().catch((error) => {
    delete preparedArtworkUris[variant];
    throw error;
  });
  preparedArtworkUris[variant] = pending;
  return pending;
}

/** The shared PsstPsst atmosphere artwork, rendered as non-semantic decoration. */
export function BrandArtworkImage({ contentPosition = 'center', style, variant = 'sunset' }: Props) {
  return (
    <Image
      source={ARTWORK_SOURCES[variant]}
      accessible={false}
      cachePolicy="memory-disk"
      contentFit="cover"
      contentPosition={contentPosition}
      style={style}
    />
  );
}
