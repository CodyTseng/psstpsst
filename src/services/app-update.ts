/** Routes explicit checks through the mounted main-window update-check handler. */
let checkHandler: (() => Promise<void>) | null = null;

export function registerAppUpdateCheck(handler: () => Promise<void>): () => void {
  checkHandler = handler;
  return () => {
    if (checkHandler === handler) checkHandler = null;
  };
}

export async function checkForAppUpdates(): Promise<void> {
  if (!checkHandler) throw new Error('Application update presenter is unavailable');
  await checkHandler();
}
