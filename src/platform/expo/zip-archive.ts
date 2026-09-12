import type { ZipArchivePort } from '../ports/zip-archive';

/**
 * `react-native-zip-archive` is a plain native module (not an Expo module), so
 * a dev client built without it throws when its events are touched. Load it
 * lazily and tolerate its absence — a static `import` would crash the whole
 * app on such a build; instead the archive feature reports itself unavailable.
 */
type ZipModule = typeof import('react-native-zip-archive');
let cached: ZipModule | null | undefined;
function load(): ZipModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('react-native-zip-archive') as ZipModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * The real availability probe: the JS wrapper loads even without the native
 * module and only throws once its event subscription is touched.
 */
function probe(Z: ZipModule): boolean {
  try {
    const subscription = Z.subscribe(() => undefined);
    subscription.remove();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Native module not found') || message.includes('RNZipArchive')) {
      return false;
    }
    throw error;
  }
}

function requireModule(): ZipModule {
  const Z = load();
  if (!Z) throw new Error('ZIP archive module is unavailable');
  return Z;
}

/** ZIP archives backed by `react-native-zip-archive`. */
export const zipArchiveAdapter: ZipArchivePort = {
  async isAvailable() {
    const Z = load();
    return Z !== null && probe(Z);
  },

  async zip(sourcePath, targetPath) {
    const Z = requireModule();
    // Best-speed compression: backup archives are local, transient artifacts.
    await Z.zip(sourcePath, targetPath, Z.BEST_SPEED);
  },

  async unzip(sourcePath, targetPath) {
    await requireModule().unzip(sourcePath, targetPath);
  },

  getUncompressedSize: (archivePath) => requireModule().getUncompressedSize(archivePath),

  addProgressListener(listener) {
    return requireModule().subscribe(({ progress }) => listener(progress));
  },
};
