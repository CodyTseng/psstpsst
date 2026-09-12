import type { BundledNoticesPort } from '../ports/bundled-notices';

/** Asset modules and native file APIs are loaded only when a notice is opened. */
export const bundledNoticesAdapter: BundledNoticesPort = {
  async openRuntimeNotices() {
    throw new Error('Desktop runtime notices are unavailable on this platform');
  },
  async readText(id) {
    const { noticeAssets } = await import('@/generated/licenses/assets');
    if (!Object.hasOwn(noticeAssets, id)) throw new Error('Unknown notice');
    const { Asset } = await import('expo-asset');
    const asset = Asset.fromModule(noticeAssets[id]());
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('Bundled notice is unavailable');
    const { File } = await import('expo-file-system');
    return new File(asset.localUri).text();
  },
};
