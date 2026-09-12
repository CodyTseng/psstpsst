import { useLocalSearchParams } from 'expo-router';
import { lazy, Suspense, useLayoutEffect } from 'react';

import { AppScreen } from '@/components/common/AppScreen';
import { loadChatPageRuntime } from '@/components/chat/chat-page-runtime-loader';
import { ScreenshotChat } from '@/components/marketing/ScreenshotChat';
import { markChatRouteCommit } from '@/lib/perf/chat-open';
import { useScreenshotPreviewStore } from '@/stores/screenshot-preview.store';

const LazyChatPageRuntime = lazy(loadChatPageRuntime);

/** Mount the real lightweight chat shell in the native route's first commit.
 * Its cached message viewport joins one macrotask later inside that same shell. */
export default function ChatPage() {
  const params = useLocalSearchParams<{ key: string; preview?: string }>();
  const conversationKey = decodeURIComponent(params.key ?? '');
  const screenshotPreviewEnabled = useScreenshotPreviewStore((state) => state.enabled);

  useLayoutEffect(() => {
    markChatRouteCommit(conversationKey);
  }, [conversationKey]);

  if (screenshotPreviewEnabled && params.preview) {
    return <ScreenshotChat previewId={params.preview} />;
  }

  return (
    <Suspense fallback={<AppScreen edges={[]}>{null}</AppScreen>}>
      <LazyChatPageRuntime />
    </Suspense>
  );
}
