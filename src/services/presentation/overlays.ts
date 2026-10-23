/** Shared presentation lifetime, including sheet exit animations and nested dialogs. */
const overlays = new Set<symbol>();
const listeners = new Set<() => void>();
export const overlayPresentation = {
  getSnapshot: () => overlays.size > 0,
  subscribe(listener: () => void) { listeners.add(listener);return () => { listeners.delete(listener); }; },
  register() {
    const token=Symbol('overlay');
    const wasVisible=overlays.size>0;
    overlays.add(token);
    if(!wasVisible)for(const listener of listeners)listener();
    return ()=>{
      if(!overlays.delete(token))return;
      if(!overlays.size)for(const listener of listeners)listener();
    };
  },
};
