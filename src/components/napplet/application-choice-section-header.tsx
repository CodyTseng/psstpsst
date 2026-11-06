import type { ReactNode } from 'react';
import { SectionLabel } from '@/components/common/SectionLabel';
import { spacing } from '@/theme';

export function ApplicationChoiceSectionHeader({ children }: { children: ReactNode }) {
  return <SectionLabel style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs }}>
    {children}
  </SectionLabel>;
}
