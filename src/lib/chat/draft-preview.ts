export type DraftPreviewState = {
  drafts: Readonly<Record<string, string>>;
};

/** Build one row-local selector. Inactive rows follow their stored draft;
 * active rows snapshot once so composer keystrokes stay local to the chat. */
export function createDraftPreviewSelector(
  conversationKey: string,
  active: boolean,
): (state: DraftPreviewState) => string | undefined {
  let initialized = false;
  let snapshot: string | undefined;
  return (state) => {
    if (!active || !initialized) {
      snapshot = state.drafts[conversationKey];
      initialized = true;
    } else if (state.drafts[conversationKey] === undefined) {
      // Clearing or sending is a committed state change, not live typing.
      snapshot = undefined;
    }
    return snapshot;
  };
}
