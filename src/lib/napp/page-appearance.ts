/** Runs in the displayed document, including opaque napplet frames. */
export function observePageAppearance(report: (color: string | null) => void) {
  let previous: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let context: CanvasRenderingContext2D | null | undefined;
  const opaqueColor = (value: string): string | null => {
    if (!CSS.supports('color', value)) return null;
    if (context === undefined) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!context) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('')}` : null;
  };
  const read = () => {
    timer = undefined;
    let color: string | null = null;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color" i]')) {
      if (meta.media && !matchMedia(meta.media).matches) continue;
      color = opaqueColor(meta.content.trim());
      if (color) break;
    }
    if (!color && document.body) color = opaqueColor(getComputedStyle(document.body).backgroundColor);
    if (!color) color = opaqueColor(getComputedStyle(document.documentElement).backgroundColor);
    if (color !== previous) { previous = color; report(color); }
  };
  const schedule = () => { timer ??= setTimeout(read, 50); };
  const start = () => {
    // Watch metadata and root styling, never the potentially huge application subtree.
    const observer = new MutationObserver(schedule);
    if (document.head) observer.observe(document.head, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['name', 'content', 'media', 'href', 'rel'] });
    for (const root of [document.documentElement, document.body]) {
      if (root) observer.observe(root, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    }
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
    document.addEventListener('load', schedule, true);
    addEventListener('pageshow', schedule);
    schedule();
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
