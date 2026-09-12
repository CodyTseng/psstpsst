import { createExpoAdapters } from './expo';
import type { PlatformAdapters } from './ports';

let adapters: PlatformAdapters | null = null;

/**
 * Install a custom adapter set before first use. This remains the future
 * desktop shell's entry point, while Expo lazily receives its default set.
 */
export function initPlatformAdapters(custom: PlatformAdapters): void {
  if (adapters) {
    throw new Error(
      '[platform] adapters already initialized — initPlatformAdapters must run before any port is used',
    );
  }
  adapters = custom;
}

/**
 * Resolve the active adapters, lazily defaulting to the Expo set so the mobile
 * and web app need no custom runtime bootstrap.
 */
export function getPlatform(): PlatformAdapters {
  if (!adapters) adapters = createExpoAdapters();
  return adapters;
}
