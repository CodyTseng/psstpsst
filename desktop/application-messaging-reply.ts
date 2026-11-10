export type ApplicationMessagingReply = { ok: true; value: unknown }
  | { ok: false; error: 'session-closed' | 'endpoint-closed' };

/** Lifecycle failures cross IPC as data so Electron preserves their cancellation codes. */
export async function applicationMessagingReply(run: () => Promise<unknown>): Promise<ApplicationMessagingReply> {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    if (error instanceof Error && (error.message === 'session-closed' || error.message === 'endpoint-closed'))
      return { ok: false, error: error.message };
    throw error;
  }
}

export function unwrapApplicationMessagingReply(reply: ApplicationMessagingReply): unknown {
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
