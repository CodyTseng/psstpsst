import type { PageAppearance } from '@/lib/page-appearance';

/** Desktop application windows retain their native title-bar presentation. */
export function useNappletAppearance(_id?: string | null): PageAppearance | undefined {
  return undefined;
}
