import { router } from 'expo-router';

type Href = Parameters<typeof router.push>[0];

let lastHref: string | null = null;
let lastAt = 0;

/**
 * Push a route, collapsing rapid duplicate pushes of the **same** href into
 * one. When the JS thread is briefly busy (e.g. the gift-wrap replay burst on
 * launch), taps queue up and then all dispatch at once — without this guard
 * each one pushes another copy of the screen, so the user lands N screens deep
 * and has to back out N times. A short window is enough: the queued taps fire
 * within milliseconds of each other, while a legitimate re-open (go back, then
 * tap again) takes far longer.
 */
export function pushOnce(href: Href, windowMs = 600): void {
  const key = typeof href === 'string' ? href : JSON.stringify(href);
  const now = Date.now();
  if (key === lastHref && now - lastAt < windowMs) return;
  lastHref = key;
  lastAt = now;
  router.push(href);
}
