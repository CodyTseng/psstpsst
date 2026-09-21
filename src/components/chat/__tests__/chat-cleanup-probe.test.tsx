import { useEffect, useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ChatCleanupProbe } from '../ChatCleanupProbe';

const mockEvents: string[] = [];
jest.mock('@/lib/perf/chat-close', () => ({
  markChatCleanupScope: (scope: string, phase: string, edge: string) => {
    mockEvents.push(`${scope}.${phase}.${edge}`);
  },
}));

it('brackets descendant layout and passive cleanup without native views', () => {
  function Child() {
    useLayoutEffect(() => () => { mockEvents.push('child.layout'); }, []);
    useEffect(() => () => { mockEvents.push('child.passive'); }, []);
    return null;
  }
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<ChatCleanupProbe scope="test"><Child /></ChatCleanupProbe>);
  });
  expect(renderer!.toJSON()).toBeNull();
  expect(mockEvents).toEqual([]);
  act(() => renderer.unmount());
  expect(mockEvents).toEqual([
    'test.layout.start', 'child.layout', 'test.layout.end',
    'test.passive.start', 'child.passive', 'test.passive.end',
  ]);
});
