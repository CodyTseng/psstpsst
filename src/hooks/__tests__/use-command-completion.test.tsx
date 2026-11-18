import fixture from '@/lib/nostr/__tests__/fixtures/chirli-command.json';
import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useCommandCompletion } from '../use-command-completion';
import type { Command } from '@/lib/nostr/commands';

const commands: Command[] = ['echo', 'help', 'ping'].map(command => ({command, title: command, description: command, args: [], scopes: [], event: {...fixture, id: command}}));
let current: ReturnType<typeof useCommandCompletion>;
let renderer: ReactTestRenderer;
const insert = jest.fn();
const send = jest.fn();
function Harness({value = '/', conversation = 'alice', items = commands}: {value?: string; conversation?: string; items?: Command[]}) {
  const completion = useCommandCompletion(items, value, conversation, insert, send);
  useLayoutEffect(() => { current = completion; });
  return null;
}
beforeEach(() => { insert.mockClear(); send.mockClear(); act(() => { renderer = create(<Harness />); }); });
afterEach(() => { act(() => renderer.unmount()); });
function key(key: string, extra = {}) { let consumed = false; act(() => { consumed = current.keyDown({key, ...extra}); }); return consumed; }

test('up/down wrap, Enter sends, Tab inserts editable text, modified Enter cannot send', () => {
  expect(key('ArrowUp')).toBe(true); expect(current.index).toBe(2);
  key('ArrowDown'); expect(current.index).toBe(0);
  key('ArrowDown'); key('Enter'); expect(send).toHaveBeenLastCalledWith('/help');
  expect(current.matches).toEqual([]);
  act(() => current.changed()); key('Tab'); expect(insert).toHaveBeenLastCalledWith('/echo ');
  act(() => current.changed()); expect(key('Enter',{metaKey:true})).toBe(true);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(key('Enter', {shiftKey:true})).toBe(false);
});

test('IME and held Enter never complete', () => {
  expect(key('Enter',{isComposing:true})).toBe(false);
  expect(key('Enter',{keyCode:229})).toBe(false);
  expect(key('Enter',{repeat:true})).toBe(true);
  expect(insert).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('dismissal survives late results, then editing and repeated slash reopen', () => {
  act(() => renderer.update(<Harness items={[]} />));
  act(() => current.dismiss());
  act(() => renderer.update(<Harness />)); expect(current.matches).toEqual([]);
  act(() => current.changed()); expect(current.matches).toHaveLength(3);
  key('Escape'); expect(current.matches).toEqual([]);
  act(() => renderer.update(<Harness value="//" />)); expect(current.matches).toEqual([]);
  act(() => current.changed());
  act(() => renderer.update(<Harness />)); expect(current.matches).toHaveLength(3);
});

test('conversation changes reset selection and dismissal, stale touch choices cannot insert', () => {
  key('ArrowDown'); key('Escape');
  act(() => renderer.update(<Harness conversation="bob" items={commands.slice(2)} />));
  expect(current.index).toBe(0); expect(current.matches[0].command).toBe('ping');
  act(() => current.select(commands[0])); expect(send).not.toHaveBeenCalled();
  act(() => current.select(commands[2])); expect(send).toHaveBeenCalledWith('/ping');
});

test.each(['required', 'optional'])('commands with %s arguments insert for editing instead of sending', required => {
  const command = { ...commands[0], args: [['arg', 'text', 'text', required, 'Text']] };
  act(() => renderer.update(<Harness items={[command]} />));
  act(() => current.select(command));
  expect(insert).toHaveBeenLastCalledWith('/echo ');
  expect(send).not.toHaveBeenCalled();
  act(() => current.changed());
  key('Enter');
  expect(insert).toHaveBeenCalledTimes(2);
  expect(send).not.toHaveBeenCalled();
});
