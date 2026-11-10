import { DESKTOP_OS, IS_ANDROID, IS_ELECTRON, IS_IOS } from '@/lib/platform';
import type { SignerClientMetadata } from '@/platform/ports/key-vault';

const desktopNames: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
const platformName = IS_IOS ? 'iOS' : IS_ANDROID ? 'Android' : IS_ELECTRON
  ? (desktopNames[DESKTOP_OS ?? ''] ?? 'Desktop')
  : 'Web';

export const DEFAULT_SIGNER_CLIENT_NAME = `PsstPsst (${platformName})`;

export function signerClientMetadata(name?: string): SignerClientMetadata {
  return {
    name: name?.trim() || DEFAULT_SIGNER_CLIENT_NAME,
    image: 'https://raw.githubusercontent.com/CodyTseng/psstpsst/master/assets/images/icon.png',
  };
}
