import { Image, type ImageLoadEventData } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ImageVisibilityContext, ImageVisibilityStore, VisibilityAwareImage } from '../VisibilityAwareImage';

const mockStartAnimating = jest.fn(async () => {});
const mockStopAnimating = jest.fn(async () => {});

jest.mock('expo-image', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  return {
    Image: forwardRef(function MockImage(_props: unknown, ref: unknown) {
      useImperativeHandle(ref, () => ({
        startAnimating: mockStartAnimating,
        stopAnimating: mockStopAnimating,
      }));
      return null;
    }),
  };
});

function loaded(isAnimated: boolean): ImageLoadEventData {
  return {
    cacheType: 'memory',
    source: { url: 'file:///image.gif', width: 80, height: 80, mediaType: 'image/gif', isAnimated },
  };
}

describe('visibility-aware image playback', () => {
  let renderer: ReactTestRenderer;
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => act(() => renderer.unmount()));

  it('keeps a buffered image paused, starts it on entry, and pauses without unmounting', () => {
    const store = new ImageVisibilityStore();
    const onDisplay = jest.fn();
    act(() => {
      renderer = create(
        <ImageVisibilityContext value={{ store, key: 'm:1' }}>
          <VisibilityAwareImage source="file:///image.gif" onDisplay={onDisplay} />
        </ImageVisibilityContext>,
      );
    });
    const image = renderer.root.findByType(Image);
    expect(image.props.autoplay).toBe(false);
    act(() => {
      image.props.onLoad(loaded(true));
      image.props.onDisplay();
      store.setVisible(['m:2']);
    });
    expect(onDisplay).toHaveBeenCalledTimes(1);
    expect(mockStartAnimating).not.toHaveBeenCalled();

    act(() => store.setVisible(['m:1', 'm:2']));
    act(() => store.setVisible(['m:1']));
    expect(mockStartAnimating).toHaveBeenCalledTimes(1);
    act(() => store.setVisible(['m:2']));
    expect(mockStopAnimating).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType(Image)).toBe(image);
    act(() => store.setVisible(['m:1']));
    expect(mockStartAnimating).toHaveBeenCalledTimes(2);
  });

  it('waits for both native events and drops a subscription when the source reloads', () => {
    const store = new ImageVisibilityStore();
    store.setVisible(['m:1']);
    act(() => {
      renderer = create(
        <ImageVisibilityContext value={{ store, key: 'm:1' }}>
          <VisibilityAwareImage source="file:///image.gif" />
        </ImageVisibilityContext>,
      );
    });
    const image = renderer.root.findByType(Image);
    act(() => { image.props.onDisplay(); });
    expect(mockStartAnimating).not.toHaveBeenCalled();
    act(() => { image.props.onLoad(loaded(true)); });
    expect(mockStartAnimating).toHaveBeenCalledTimes(1);
    act(() => store.setActive(false));
    act(() => store.setActive(true));
    expect(mockStopAnimating).toHaveBeenCalledTimes(1);
    expect(mockStartAnimating).toHaveBeenCalledTimes(2);
    act(() => {
      image.props.onLoadStart();
      image.props.onLoad(loaded(false));
      image.props.onDisplay();
      store.setVisible([]);
      store.setVisible(['m:1']);
    });
    expect(mockStartAnimating).toHaveBeenCalledTimes(2);
    expect(mockStopAnimating).toHaveBeenCalledTimes(2);
  });

  it('preserves autoplay outside the managed timeline', () => {
    act(() => { renderer = create(<VisibilityAwareImage source="file:///image.gif" autoplay />); });
    expect(renderer.root.findByType(Image).props.autoplay).toBe(true);
  });
});
