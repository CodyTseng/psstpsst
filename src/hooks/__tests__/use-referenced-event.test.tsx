import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { NostrEventReference } from '@/lib/nostr/event-reference';
import { fetchReferencedEvent, getCachedReferencedEvent } from '@/services/nostr/event-reference.service';

import { useReferencedEvent } from '../use-referenced-event';

jest.mock('@/services/nostr/event-reference.service', () => ({
  canResolveReferencedEvent: () => true,
  fetchReferencedEvent: jest.fn(async () => null),
  getCachedReferencedEvent: jest.fn(),
}));

const reference = { bech32: 'note-test' } as NostrEventReference;

it('reads cached event content while held and fetches only after activation', async () => {
  const cached = { kind: 1, content: 'Cached note' };
  jest.mocked(getCachedReferencedEvent).mockReturnValue(cached as never);
  let state: ReturnType<typeof useReferencedEvent> | undefined;
  function Preview({ enabled }: { enabled: boolean }) {
    state = useReferencedEvent(reference, enabled);
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Preview enabled={false} />); });
  expect(state?.event).toBe(cached);
  expect(fetchReferencedEvent).not.toHaveBeenCalled();
  jest.mocked(getCachedReferencedEvent).mockReturnValue(undefined);
  await act(async () => { renderer.update(<Preview enabled />); });
  expect(fetchReferencedEvent).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});
