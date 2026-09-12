/** Cap a badge count at "99+" so every unread surface shows the same label. */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}
