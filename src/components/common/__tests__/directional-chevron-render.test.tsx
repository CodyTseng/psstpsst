import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DirectionalChevron } from '../DirectionalChevron';

let mockIsRTL = false;

jest.mock(
  'lucide-react-native/icons/chevron-left',
  () => ({ __esModule: true, default: jest.fn(() => null) }),
  { virtual: true },
);
jest.mock(
  'lucide-react-native/icons/chevron-right',
  () => ({ __esModule: true, default: jest.fn(() => null) }),
  { virtual: true },
);

const mockChevronLeft = jest.requireMock('lucide-react-native/icons/chevron-left')
  .default as jest.Mock;
const mockChevronRight = jest.requireMock('lucide-react-native/icons/chevron-right')
  .default as jest.Mock;

jest.mock('@/i18n/direction', () => ({
  useIsRTL: () => mockIsRTL,
}));

describe('DirectionalChevron', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockIsRTL = false;
    mockChevronLeft.mockClear();
    mockChevronRight.mockClear();
  });

  it.each([
    { isRTL: false, Icon: mockChevronRight, OtherIcon: mockChevronLeft },
    { isRTL: true, Icon: mockChevronLeft, OtherIcon: mockChevronRight },
  ])('uses the matching glyph and preserves caller style when RTL is $isRTL', (expected) => {
    mockIsRTL = expected.isRTL;
    const style = { transform: [{ translateX: -6 }] } as const;

    act(() => {
      renderer = create(<DirectionalChevron size={16} color="black" style={style} />);
    });

    expect(expected.Icon).toHaveBeenCalledWith(
      expect.objectContaining({ size: 16, color: 'black', style }),
      undefined,
    );
    expect(expected.OtherIcon).not.toHaveBeenCalled();
  });
});
