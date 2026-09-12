import { getElectronBridge } from './bridge';
import type { BundledNoticesPort } from '../ports/bundled-notices';

/** Metro publishes these assets with the renderer; no filesystem IPC or internet is needed. */
export const electronBundledNoticesAdapter: BundledNoticesPort = {
  openRuntimeNotices: () => getElectronBridge().system.openRuntimeNotices(),
  async readText(id) {
    const { noticeAssets } = await import('@/generated/licenses/assets');
    if (!Object.hasOwn(noticeAssets, id)) throw new Error('Unknown notice');
    const { Asset } = await import('expo-asset');
    const asset = Asset.fromModule(noticeAssets[id]());
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error(`Bundled notice is unavailable (${response.status})`);
    return response.text();
  },
};
