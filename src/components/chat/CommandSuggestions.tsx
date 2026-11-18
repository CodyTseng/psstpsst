import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ListRow } from '@/components/common/ListRow';
import type { Command } from '@/lib/nostr/commands';
import { radius, shadow, uiDensity, useThemeColors } from '@/theme';

const VISIBLE_ROWS = 3;

/** Single-line completions distinguish the command from its supporting copy. */
export function CommandSuggestions({ commands, selectedIndex, onSelect, extensionHeight }: {
  commands: Command[];
  selectedIndex: number;
  onSelect: (command: Command) => void;
  extensionHeight: number;
}) {
  const c = useThemeColors();
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollTo({
      y: Math.max(0, selectedIndex - 1) * uiDensity.listRowCompactHeight,
      animated: false,
    });
  }, [selectedIndex, commands]);

  return (
    <View testID="command-suggestions-surface" style={{ backgroundColor: c.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
      borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg,
      overflow: 'hidden', ...shadow.float }}>
      <ScrollView
        ref={scroll}
        testID="command-suggestions"
        style={{ maxHeight: uiDensity.listRowCompactHeight * VISIBLE_ROWS }}
        keyboardShouldPersistTaps="always"
      >
        {commands.map((command, index) => (
          <ListRow
            key={command.event.id}
            variant="list"
            compact
            title={`/${command.command}`}
            subtitle={command.description}
            subtitlePlacement="inline"
            accessibilityRole="button"
            accessibilityLabel={`/${command.command}. ${command.title}. ${command.description}`}
            active={index === selectedIndex}
            onPress={() => onSelect(command)}
          />
        ))}
      </ScrollView>
      <View testID="command-suggestions-extension" style={{ height: extensionHeight, pointerEvents: 'none' }} />
    </View>
  );
}
