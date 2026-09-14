import { Asset } from 'expo-asset';
import { Image, type ImageProps } from 'expo-image';

import { platform } from '@/platform';

type Props = Pick<ImageProps, 'contentPosition' | 'style'>;

const BRAND_ARTWORK_SOURCE = require('../../../assets/images/brand/cats-at-sunset.png');
let preparedArtworkUri: Promise<string> | null = null;

/** Stage the bundled artwork in the shared cache so the lightbox can also save it. */
export function prepareBrandArtworkUri(): Promise<string> {
  if (preparedArtworkUri) return preparedArtworkUri;
  preparedArtworkUri = (async () => {
    const bundledAsset = Asset.fromModule(BRAND_ARTWORK_SOURCE);
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

    const revision = bundledAsset.hash ?? 'cats-at-sunset-v2';
    const destination = `${cacheDirectory}brand-artwork-${revision}.png`;
    if (!(await platform.fileSystem.stat(destination)).exists) {
      await platform.fileSystem.copy(sourceUri, destination);
    }
    return destination;
  })().catch((error) => {
    preparedArtworkUri = null;
    throw error;
  });
  return preparedArtworkUri;
}

/** The shared PsstPsst atmosphere artwork, rendered as non-semantic decoration. */
export function BrandArtworkImage({ contentPosition = 'center', style }: Props) {
  return (
    <Image
      source={BRAND_ARTWORK_SOURCE}
      accessible={false}
      cachePolicy="memory-disk"
      contentFit="cover"
      contentPosition={contentPosition}
      style={style}
    />
  );
}
