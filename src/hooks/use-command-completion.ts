import { useState } from 'react';
import { commandQuery, type Command } from '@/lib/nostr/commands';

export type CompletionKey = { key?: string; isComposing?: boolean; keyCode?: number; repeat?: boolean; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

/** Completion state is keyed by conversation AND draft, including late discovery results. */
export function useCommandCompletion(commands: Command[], value: string, conversation: string | undefined,
  insert: (value: string) => void, send: (value: string) => void) {
  const token = JSON.stringify([conversation, value]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ token: string; index: number } | null>(null);
  const query = commandQuery(value);
  const matches = query !== null && dismissed !== token
    ? commands.filter(command => command.command.toLowerCase().startsWith(query.toLowerCase())).slice(0, 8) : [];
  const index = selection?.token === token ? Math.min(selection.index, matches.length - 1) : 0;
  function select(command: Command, insertOnly = false) {
    if (!matches.includes(command)) return;
    setDismissed(token);
    if (!insertOnly && command.args.length === 0) send(`/${command.command}`);
    else insert(`/${command.command} `);
  }
  function dismiss() { setDismissed(token); }
  function changed() { setDismissed(null); setSelection(null); }
  function keyDown(event: CompletionKey): boolean {
    if (!matches.length || event.isComposing || event.keyCode === 229) return false;
    const key = event.key;
    if (key === 'Escape') { dismiss(); return true; }
    if (event.shiftKey || event.altKey) return false;
    if (event.metaKey || event.ctrlKey) {
      // Sending shortcuts must never publish while the completion picker owns Enter.
      return key === 'Enter';
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const delta = key === 'ArrowUp' ? -1 : 1;
      setSelection({ token, index: (index + delta + matches.length) % matches.length });
      return true;
    }
    if (key === 'Enter' || key === 'Tab') {
      if (!event.repeat) select(matches[index], key === 'Tab');
      return true;
    }
    return false;
  }
  return { matches, index, select, dismiss, changed, keyDown, dismissible: query !== null && dismissed !== token };
}
