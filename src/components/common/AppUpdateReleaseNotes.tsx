import { memo, useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { AppUpdateChangelogEntry } from '@/platform/ports/app-update';
import { spacing } from '@/theme';
import { AppText } from './AppText';

/** Convert an inert fragment into text; remote markup never enters the live document. */
function readableText(source: string): string {
  if (typeof document === 'undefined' || !/<[a-z][\s\S]*>/i.test(source)) return source;
  const fragment = document.createElement('template');
  fragment.innerHTML = source;
  fragment.content.querySelectorAll('script, style, iframe, object, embed, img, video, audio, svg, math, template').forEach(node => node.remove());
  const blocks = Array.from(fragment.content.querySelectorAll('br, h1, h2, h3, h4, h5, h6, li, p, div, pre, blockquote'));
  // Process descendants before ancestors to retain line and list boundaries.
  for (const node of blocks.reverse()) {
    const tag = node.tagName.toLowerCase();
    const text = node.textContent ?? '';
    const replacement = tag === 'br' ? '\n' : /^h[1-6]$/.test(tag) ? `\n### ${text}\n`
      : tag === 'li' ? `\n• ${text}` : `\n${text}\n`;
    node.replaceWith(document.createTextNode(replacement));
  }
  return fragment.content.textContent ?? '';
}

/** Release notes have a deliberately small, non-interactive formatting vocabulary. */
function parseBlocks(source: string): { heading: boolean; text: string }[] {
  const blocks: { heading: boolean; text: string }[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ heading: false, text: paragraph.join('\n') });
    paragraph = [];
  };
  for (const raw of readableText(source).split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (!line || heading) {
      flush();
      if (heading) blocks.push({ heading: true, text: heading[1] });
    } else paragraph.push(line.replace(/^[-*+]\s+/, '• '));
  }
  flush();
  return blocks;
}

const ReleaseNoteBody = memo(function ReleaseNoteBody({ note }: { note: string }) {
  const blocks = useMemo(() => parseBlocks(note), [note]);
  return <View style={{ gap: spacing.sm }}>{blocks.map((block, index) =>
    <AppText key={index} selectable variant="body" weight={block.heading ? 'semibold' : 'regular'}>{block.text}</AppText>,
  )}</View>;
});

/** Download progress does not reparse settled release-note bodies. */
export const AppUpdateReleaseNotes = memo(function AppUpdateReleaseNotes({ version, note, changelog }: {
  version: string;
  note?: string;
  changelog?: AppUpdateChangelogEntry[];
}) {
  const { t } = useTranslation();
  const entries = changelog?.length ? changelog : [{ version, note: note ?? '' }];
  return <View style={{ gap: spacing.xl }}>
    {entries.map((entry, index) => <View key={`${entry.version}:${index}`} style={{ gap: spacing.sm }}>
      <AppText variant="body" weight="bold" accessibilityRole="header">{t('about.version', { version: entry.version })}</AppText>
      {entry.note.trim() ? <ReleaseNoteBody note={entry.note} /> : !entry.truncated ? <AppText tone="muted">{t('app_update.release_notes_unavailable')}</AppText> : null}
      {entry.truncated ? <AppText variant="caption" tone="muted">{t('app_update.release_notes_truncated')}</AppText> : null}
    </View>)}
  </View>;
});
