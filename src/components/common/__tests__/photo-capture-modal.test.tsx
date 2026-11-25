import { Modal } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { overlayPresentation } from '@/services/presentation/overlays';
import { PhotoCaptureModal } from '../PhotoCaptureModal';

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('@solar-icons/react-native/category/video/Linear/Camera', () => ({ Camera: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/x', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));
jest.mock('@/platform', () => ({}));
jest.mock('@/theme/icons', () => ({ iconStrokeWidth: { default: 2 } }));
jest.mock('@/theme', () => ({
  spacing: {},
  uiDensity: {},
  useThemeColors: () => ({}),
}));
jest.mock('../IconButton', () => ({ IconButton: () => null }));

it('keeps blocking chat until the Electron camera modal finishes exiting', () => {
  const props = {
    permissionDeniedMessage: 'Camera unavailable',
    accessibilityLabel: 'Take photo',
    onClose: jest.fn(),
    onCaptured: jest.fn(),
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<PhotoCaptureModal {...props} visible={false} />); });
  try {
    expect(overlayPresentation.getSnapshot()).toBe(false);
    act(() => { renderer.update(<PhotoCaptureModal {...props} visible />); });
    expect(overlayPresentation.getSnapshot()).toBe(true);
    act(() => { renderer.update(<PhotoCaptureModal {...props} visible={false} />); });
    expect(overlayPresentation.getSnapshot()).toBe(true);
    act(() => { renderer.root.findByType(Modal).props.onDismiss(); });
    expect(overlayPresentation.getSnapshot()).toBe(false);
  } finally {
    act(() => { renderer.unmount(); });
  }
});
