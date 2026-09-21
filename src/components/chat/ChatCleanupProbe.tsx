import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { markChatCleanupScope } from '@/lib/perf/chat-close';

function CleanupMarker({ scope, edge }: {
  scope: string;
  edge: 'start' | 'end';
}) {
  useLayoutEffect(() => () => markChatCleanupScope(scope, 'layout', edge), [scope, edge]);
  useEffect(() => () => markChatCleanupScope(scope, 'passive', edge), [scope, edge]);
  return null;
}

/** Sibling sentinels bracket descendant cleanup without adding native views.
 * Layout timings also include work React performs between the two sentinels;
 * they are not a measurement of native transition completion. */
export function ChatCleanupProbe({ scope, children }: { scope: string; children: ReactNode }) {
  return (
    <>
      <CleanupMarker scope={scope} edge="start" />
      {children}
      <CleanupMarker scope={scope} edge="end" />
    </>
  );
}
