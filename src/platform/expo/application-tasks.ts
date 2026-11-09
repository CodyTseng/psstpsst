import { requireOptionalNativeModule } from 'expo-modules-core';
import { IS_ANDROID } from '@/lib/platform';
import type { ApplicationTasksPort, ApplicationTaskDrawerOptions } from '../ports/application-tasks';

type NativeTasks = {
  supportsApplicationTasks?(): boolean;
  activeTask(): string | null;
  openTaskAsync(id: string, title: string): Promise<void>;
  focusTaskAsync(id: string): Promise<void>;
  closeTaskAsync(id: string): Promise<void>;
  showTaskHostAsync(): Promise<void>;
  configureTaskDrawerAsync?(id: string, options: ApplicationTaskDrawerOptions): Promise<void>;
  releaseTaskDrawerAsync?(id: string, viewTag: number): Promise<void>;
  addListener(event: 'onTaskDrawerChange', listener: (value: { id: string; expanded: boolean; offsetY: number }) => void): { remove(): void };
  addListener(event: string, listener: (value: { id: string | null }) => void): { remove(): void };
};
const native = IS_ANDROID ? requireOptionalNativeModule<NativeTasks>('ExpoNapplet') : null;
const listeners = new Set<(id: string | null) => void>();
let active = native?.supportsApplicationTasks?.() ? native.activeTask() : null;
if (native?.supportsApplicationTasks?.()) native.addListener('onTaskActive', value => {
  active = value.id;
  for (const listener of listeners) listener(active);
});
export const applicationTasksAdapter: ApplicationTasksPort | undefined = native?.supportsApplicationTasks?.() ? {
  open: (id, title) => native.openTaskAsync(id, title),
  focus: id => native.focusTaskAsync(id),
  close: id => native.closeTaskAsync(id),
  showHost: () => native.showTaskHostAsync(),
  configureDrawer: (id, options) => native.configureTaskDrawerAsync?.(id, options)
    ?? Promise.reject(new Error('applications.rebuild_required')),
  releaseDrawer: (id, viewTag) => native.releaseTaskDrawerAsync?.(id, viewTag) ?? Promise.resolve(),
  onDrawerChange(listener) { const subscription = native.addListener('onTaskDrawerChange', ({ id, expanded, offsetY }) => listener(id, expanded, offsetY)); return () => subscription.remove(); },
  active: () => active,
  onActive(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  onClosed(listener) { const subscription = native.addListener('onTaskClosed', ({ id }) => { if (id) listener(id); }); return () => subscription.remove(); },
} : undefined;
