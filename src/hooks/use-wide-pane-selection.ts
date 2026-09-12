import { usePrimaryPaneNavigation } from '@/components/navigation/primary-pane-navigation';

export function useWidePaneSelection() {
  return usePrimaryPaneNavigation().selection;
}
