import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { StyleSheet } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useFocusedOverlayDismiss } from '@/components/common/use-focused-overlay-dismiss';

type ChatComposerPanelContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const ChatComposerPanelContext = createContext<ChatComposerPanelContextValue | null>(null);

/** Keeps volatile attachment/emoji panel state below the chat page so toggling
 * composer chrome does not re-render the message list or its data hooks. */
export function ChatComposerPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);

  return (
    <ChatComposerPanelContext.Provider value={value}>
      {children}
    </ChatComposerPanelContext.Provider>
  );
}

export function useChatComposerPanel(): ChatComposerPanelContextValue {
  const value = useContext(ChatComposerPanelContext);
  if (!value) {
    throw new Error('useChatComposerPanel must be used inside ChatComposerPanelProvider');
  }
  return value;
}

/** Transparent message-area shield while a keyboard-replacement panel is open. */
export function ChatComposerPanelDismissOverlay() {
  const { open, setOpen } = useChatComposerPanel();
  const close = useCallback(() => setOpen(false), [setOpen]);

  if (!open) return null;
  return <Pressable style={StyleSheet.absoluteFill} onPress={close} />;
}

/** Dismisses an open keyboard-replacement panel before route or page handling. */
export function ChatComposerPanelBackHandler() {
  const { open, setOpen } = useChatComposerPanel();
  const close = useCallback(() => setOpen(false), [setOpen]);
  useFocusedOverlayDismiss(open, close);

  return null;
}
