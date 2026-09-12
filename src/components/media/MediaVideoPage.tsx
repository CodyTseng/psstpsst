import { useVideoPlayer, VideoView } from 'expo-video';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AttachmentFailure } from '@/components/chat/AttachmentFailure';
import type { ConversationMediaItem } from '@/hooks/use-conversation-media';
import { revealOrRetry } from '@/lib/attachments/failure';
import type { EmbeddedMedia } from '@/lib/nostr/embedded-media';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import {
  type AttachmentErrorKind,
  attachmentErrorKind,
  fetchAndDecryptAttachment,
  getCachedAttachmentUri,
  getSessionCachedUri,
} from '@/services/files/file-attachment.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useThemeColors } from '@/theme';

type Props = {
  item: ConversationMediaItem;
  /** Whether this is the focused pager page — an off-screen video is paused. */
  active: boolean;
};

export function MediaVideoPage({ item, active }: Props) {
  return item.source === 'attachment' ? (
    <AttachmentMediaVideoPage meta={item.meta} active={active} />
  ) : (
    <RemoteMediaVideoPage media={item.meta} active={active} />
  );
}

/**
 * Full-screen video page of the media pager. Like the in-bubble video, the
 * (possibly large) blob isn't fetched until the user taps play; an already-
 * downloaded one resolves from the local store and is ready to play. Paused
 * whenever it scrolls off-screen so swiping away stops the sound.
 */
function AttachmentMediaVideoPage({
  meta,
  active,
}: {
  meta: FileAttachmentMeta;
  active: boolean;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useActiveAccount((s) => s.activePubkey);
  const [uri, setUri] = useState<string | null>(() => getSessionCachedUri(meta));
  const [loading, setLoading] = useState(false);
  const [failKind, setFailKind] = useState<AttachmentErrorKind | null>(null);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  // Auto-play only right after an explicit tap, never on mount (a session-cached
  // video would otherwise start the moment the page is rendered).
  const autoPlayRef = useRef(false);
  useEffect(() => {
    if (uri && autoPlayRef.current) {
      autoPlayRef.current = false;
      player.play();
    }
  }, [uri, player]);

  // Swiping to another page pauses this one.
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  // Resolve an already-downloaded video from the local store on mount (no
  // network); a missing one waits for a tap. Never auto-plays.
  useEffect(() => {
    if (uri) return;
    let cancelled = false;
    getCachedAttachmentUri(meta)
      .then((cached) => {
        if (!cancelled && cached) setUri(cached);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [meta.cipherSha256Hex]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load(allowIntegrityMismatch = false) {
    if (loading || uri) return;
    setLoading(true);
    setFailKind(null);
    try {
      autoPlayRef.current = true;
      setUri(await fetchAndDecryptAttachment(meta, { accountPubkey, allowIntegrityMismatch }));
    } catch (err) {
      autoPlayRef.current = false;
      setFailKind(attachmentErrorKind(err));
    } finally {
      setLoading(false);
    }
  }

  function onTap() {
    void revealOrRetry(failKind, t, 'play', (allow) => void load(allow));
  }

  if (uri) {
    return (
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
      />
    );
  }

  return (
    <Pressable
      onPress={onTap}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      {loading ? (
        <ActivityIndicator color={c.onOverlay} />
      ) : failKind ? (
        <AttachmentFailure kind={failKind} action="play" iconSize={28} />
      ) : (
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: c.overlay,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Play size={32} color={c.onOverlay} fill={c.onOverlay} />
        </View>
      )}
    </Pressable>
  );
}

function RemoteMediaVideoPage({ media, active }: { media: EmbeddedMedia; active: boolean }) {
  const c = useThemeColors();
  const [uri, setUri] = useState<string | null>(null);
  const autoPlayRef = useRef(false);
  const source = useMemo(
    () => (uri ? { uri, useCaching: !media.streaming } : null),
    [media.streaming, uri],
  );
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    if (uri && autoPlayRef.current) {
      autoPlayRef.current = false;
      player.play();
    }
  }, [player, uri]);

  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  function load() {
    if (uri) return;
    autoPlayRef.current = true;
    setUri(media.url);
  }

  if (uri) {
    return (
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
      />
    );
  }

  return (
    <Pressable
      onPress={load}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: c.overlay,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Play size={32} color={c.onOverlay} fill={c.onOverlay} />
      </View>
    </Pressable>
  );
}
