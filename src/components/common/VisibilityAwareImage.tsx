import { Image, type ImageProps } from 'expo-image';
import { createContext, useCallback, useContext, useLayoutEffect, useRef } from 'react';

type VisibilityListener = (visible: boolean) => void;

/** Publish only visibility changes, without re-rendering the list or its cells. */
export class ImageVisibilityStore {
  private visible = new Set<string>();
  private active = true;
  private listeners = new Map<string, Set<VisibilityListener>>();

  isActive(): boolean {
    return this.active;
  }

  isVisible(key: string): boolean {
    return this.active && this.visible.has(key);
  }

  setVisible(keys: Iterable<string>) {
    const previous = this.visible;
    this.visible = new Set(keys);
    if (!this.active) return;
    for (const key of previous) {
      if (!this.visible.has(key)) this.notify(key, false);
    }
    for (const key of this.visible) {
      if (!previous.has(key)) this.notify(key, true);
    }
  }

  setRowVisible(key: string, visible: boolean) {
    if (visible === this.visible.has(key)) return;
    if (visible) this.visible.add(key);
    else this.visible.delete(key);
    if (this.active) this.notify(key, visible);
  }

  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    for (const key of this.visible) this.notify(key, active);
  }

  subscribe(key: string, listener: VisibilityListener): () => void {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  private notify(key: string, visible: boolean) {
    this.listeners.get(key)?.forEach((listener) => listener(visible));
  }
}

type ImageVisibility = { store: ImageVisibilityStore; key: string };
export const ImageVisibilityContext = createContext<ImageVisibility | null>(null);
export const ImageVisibilityStoreContext = createContext<ImageVisibilityStore | null>(null);

/** Images outside an opting-in list keep their usual playback behavior. */
export function VisibilityAwareImage(props: ImageProps) {
  const visibility = useContext(ImageVisibilityContext);
  if (!visibility || props.autoplay === false) return <Image {...props} />;
  return <ManagedImage {...props} visibility={visibility} />;
}

function ManagedImage({ visibility, onLoadStart, onLoad, onDisplay, onError, ...props }:
  ImageProps & { visibility: ImageVisibility }) {
  const image = useRef<Image>(null);
  const animated = useRef(false);
  const displayed = useRef(false);
  const unsubscribe = useRef<(() => void) | null>(null);
  const { store, key } = visibility;

  const setPlaying = useCallback((playing: boolean) => {
    const view = image.current;
    if (!view) return;
    const command = playing ? view.startAnimating() : view.stopAnimating();
    // The native view can be removed while a command is queued.
    void command.catch(() => {});
  }, []);

  const subscribeWhenReady = useCallback(() => {
    // Expo Image reports decoding and display separately. Wait for the
    // drawable to be installed before attempting to play it.
    if (!animated.current || !displayed.current || unsubscribe.current) return;
    unsubscribe.current = store.subscribe(key, setPlaying);
    if (store.isVisible(key)) setPlaying(true);
  }, [key, setPlaying, store]);

  const unsubscribeFromVisibility = useCallback(() => {
    if (!unsubscribe.current) return;
    unsubscribe.current();
    unsubscribe.current = null;
    if (store.isVisible(key)) setPlaying(false);
  }, [key, setPlaying, store]);

  useLayoutEffect(() => {
    subscribeWhenReady();
    return unsubscribeFromVisibility;
  }, [subscribeWhenReady, unsubscribeFromVisibility]);

  function reset() {
    unsubscribeFromVisibility();
    animated.current = false;
    displayed.current = false;
  }

  return (
    <Image
      {...props}
      ref={image}
      autoplay={false}
      onLoadStart={() => {
        reset();
        onLoadStart?.();
      }}
      onLoad={(event) => {
        animated.current = event.source.isAnimated === true;
        subscribeWhenReady();
        onLoad?.(event);
      }}
      onDisplay={() => {
        displayed.current = true;
        subscribeWhenReady();
        onDisplay?.();
      }}
      onError={(event) => {
        reset();
        onError?.(event);
      }}
    />
  );
}
