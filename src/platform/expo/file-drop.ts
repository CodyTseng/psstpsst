import type { FileDropPort, FileDropTargetOptions } from '../ports/file-drop';

const targets: FileDropTargetOptions[] = [];
let modulePromise: Promise<typeof import('../../../modules/expo-file-drop/src')> | null = null;
let listenersInstalled = false;
let nativeEnabled: boolean | null = null;

function loadModule() {
  modulePromise ??= import('../../../modules/expo-file-drop/src');
  return modulePromise;
}

function activeTarget(): FileDropTargetOptions | undefined {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    if (targets[index].enabled) return targets[index];
  }
  return undefined;
}

function discardUnclaimedFiles(files: Parameters<FileDropTargetOptions['onDrop']>[0]): void {
  void import('./file-system')
    .then(({ fileSystemAdapter }) =>
      Promise.all(
        files.map((file) =>
          fileSystemAdapter.delete(file.uri, { idempotent: true }).catch(() => undefined),
        ),
      ),
    )
    .catch(() => undefined);
}

function installListeners(native: Awaited<ReturnType<typeof loadModule>>['default']): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  native.addListener('onDragStateChanged', ({ active }) => {
    activeTarget()?.onDragStateChanged(active);
  });
  native.addListener('onDrop', ({ files }) => {
    const target = activeTarget();
    if (target) target.onDrop(files);
    else discardUnclaimedFiles(files);
  });
}

function syncEnabled(): void {
  void loadModule().then(({ default: native }) => {
    installListeners(native);
    const enabled = targets.some((target) => target.enabled);
    if (nativeEnabled === enabled) return;
    nativeEnabled = enabled;
    return native.setEnabledAsync(enabled);
  });
}

export const fileDropAdapter: FileDropPort = {
  registerTarget(options) {
    targets.push(options);
    syncEnabled();
    return {
      remove() {
        const index = targets.indexOf(options);
        if (index < 0) return;
        options.onDragStateChanged(false);
        targets.splice(index, 1);
        syncEnabled();
      },
    };
  },
};
