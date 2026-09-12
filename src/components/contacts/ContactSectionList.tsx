import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { SectionLabel } from '@/components/common/SectionLabel';
import { ContactIndexRail } from '@/components/contacts/ContactIndexRail';
import { ContactListItem } from '@/components/conversation/ContactListItem';
import type { ContactEntry } from '@/hooks/use-contact-entries';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type Section = { title: string; data: ContactEntry[] };

export type ContactSectionListHandle = {
  scrollToTop: (animated?: boolean) => void;
};

// Fixed cell heights — the index rail's `scrollToLocation` only reaches a section
// if the list knows its full layout up front (`getItemLayout`); otherwise far,
// not-yet-measured sections fail to resolve and the scroll clamps back to the
// top. Both are constant: every row is a 56px `ContactListItem`, every header is
// the View below (8px top + caption lineHeight 18 + 8px bottom).
const ROW_HEIGHT = uiDensity.contactRowHeight;
const SECTION_HEADER_HEIGHT = uiDensity.sectionHeaderHeight;

type Props = {
  /** Address-book-sorted entries (see {@link useContactEntries}); grouped here. */
  entries: ContactEntry[];
  /** Tapping anywhere in a row, including its avatar. */
  onSelect: (pubkey: string) => void;
  /** Pinned to the top of the list (e.g. a search affordance). */
  ListHeaderComponent?: React.ReactElement | null;
  /** Forwarded so a host header can show its bottom hairline once scrolled
   * (see `useScrolled`). The throttle is set internally. */
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Space after the final row, including any overlaid bottom chrome. */
  contentBottomInset?: number;
  /** Multi-select mode: when set, each row shows a selection dot reflecting
   * membership, and `onSelect` toggles the pubkey rather than navigating. */
  selectedPubkeys?: Set<string>;
  /** 0→1 progress of multi-select mode, shared across rows so they slide as one
   * (see {@link ContactListItem}). */
  selectProgress?: SharedValue<number>;
};

/**
 * The contacts list as a sticky-sectioned multilingual `SectionList` with the
 * press-and-drag jump rail ({@link ContactIndexRail}) overlaid. Self-contained:
 * sectioning, the `getItemLayout` the rail needs to reach far sections, and the
 * jump/retry plumbing all live here so any screen can drop in the same list
 * (Contacts tab, New chat) by passing entries + an `onSelect`.
 */
export const ContactSectionList = forwardRef<ContactSectionListHandle, Props>(function ContactSectionList(
  {
    entries,
    onSelect,
    ListHeaderComponent,
    onScroll,
    contentBottomInset = spacing.lg,
    selectedPubkeys,
    selectProgress,
  },
  ref,
) {
  const c = useThemeColors();

  const sections = useMemo<Section[]>(() => {
    const groups = new Map<string, ContactEntry[]>();
    for (const entry of entries) {
      const title = entry.index.section;
      const group = groups.get(title);
      if (group) group.push(entry);
      else groups.set(title, [entry]);
    }
    // Entries already carry localized ordering, so first occurrence establishes
    // section order. Appending in place keeps grouping O(n), including when a
    // large proportion of the address book shares one initial.
    return Array.from(groups.entries()).map(([title, data]) => ({ title, data }));
  }, [entries]);

  const sectionListRef = useRef<SectionList<ContactEntry, Section>>(null);
  const listHeaderHeight = useRef(0);
  const scrollOffset = useRef(0);
  const stickySectionRef = useRef<string | null>(null);
  const [stickySection, setStickySection] = useState<string | null>(null);
  // Index jump target awaiting a retry. Without `getItemLayout`, scrolling to a
  // section that hasn't been measured yet fails (onScrollToIndexFailed) — but the
  // failed attempt still scrolls partway toward it, rendering more rows, so a
  // short retry then lands. Capped so a bad target can't loop forever.
  const pendingJump = useRef<{ sectionIndex: number; attempts: number } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop(animated = true) {
        pendingJump.current = null;
        sectionListRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated });
      },
    }),
    [],
  );

  // Per-section start of the flattened cell stream the list virtualizes. Each
  // section spans `n + 2` cells — header, its n rows, then a (zero-height)
  // footer — so we can map any flat index to its pixel offset in O(sections).
  const sectionLayout = useMemo(() => {
    const meta: { startFlat: number; startOffset: number; n: number }[] = [];
    let flat = 0;
    let offset = 0;
    for (const s of sections) {
      const n = s.data.length;
      meta.push({ startFlat: flat, startOffset: offset, n });
      flat += n + 2; // header + rows + footer
      offset += SECTION_HEADER_HEIGHT + n * ROW_HEIGHT; // footer is 0px
    }
    return meta;
  }, [sections]);

  const getItemLayout = useCallback(
    (_data: unknown, flatIndex: number) => {
      for (let s = sectionLayout.length - 1; s >= 0; s--) {
        const m = sectionLayout[s];
        if (flatIndex < m.startFlat) continue;
        const local = flatIndex - m.startFlat; // 0 = header, 1..n = rows, n+1 = footer
        if (local === 0) {
          return { length: SECTION_HEADER_HEIGHT, offset: m.startOffset, index: flatIndex };
        }
        if (local <= m.n) {
          return {
            length: ROW_HEIGHT,
            offset: m.startOffset + SECTION_HEADER_HEIGHT + (local - 1) * ROW_HEIGHT,
            index: flatIndex,
          };
        }
        return {
          length: 0,
          offset: m.startOffset + SECTION_HEADER_HEIGHT + m.n * ROW_HEIGHT,
          index: flatIndex,
        };
      }
      return { length: 0, offset: 0, index: flatIndex };
    },
    [sectionLayout],
  );

  const scrollToSection = useCallback((sectionIndex: number) => {
    sectionListRef.current?.scrollToLocation({
      sectionIndex,
      itemIndex: 0,
      animated: false,
      viewOffset: 0,
    });
  }, []);

  const jumpTo = useCallback(
    (sectionIndex: number) => {
      pendingJump.current = { sectionIndex, attempts: 0 };
      scrollToSection(sectionIndex);
    },
    [scrollToSection],
  );

  // One letter per section, in list order — the rail's tappable/scrubbable index.
  const indexTitles = useMemo(() => sections.map((s) => s.title), [sections]);

  const updateStickySection = useCallback(
    (offset: number) => {
      let next: string | null = null;
      let nextOffset = -Infinity;
      if (offset > 0) {
        for (let index = 0; index < sections.length; index++) {
          const headerOffset =
            listHeaderHeight.current + (sectionLayout[index]?.startOffset ?? 0);
          if (headerOffset <= offset && headerOffset > nextOffset) {
            const section = sections[index];
            next = section.title;
            nextOffset = headerOffset;
          }
        }
      }
      if (stickySectionRef.current === next) return;
      stickySectionRef.current = next;
      setStickySection(next);
    },
    [sectionLayout, sections],
  );

  const handleListHeaderLayout = useCallback(
    (event: LayoutChangeEvent) => {
      listHeaderHeight.current = event.nativeEvent.layout.height;
      updateStickySection(scrollOffset.current);
    },
    [updateStickySection],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = Math.max(0, event.nativeEvent.contentOffset.y);
      scrollOffset.current = offset;
      updateStickySection(offset);
      onScroll?.(event);
    },
    [onScroll, updateStickySection],
  );

  return (
    <View style={{ flex: 1 }}>
      <SectionList
        ref={sectionListRef}
        sections={sections}
        keyExtractor={(item) => item.pubkey}
        getItemLayout={getItemLayout}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={handleScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          ListHeaderComponent ? (
            <View onLayout={handleListHeaderLayout}>{ListHeaderComponent}</View>
          ) : null
        }
        renderSectionHeader={({ section: { title } }) => (
          <View
            style={{
              height: SECTION_HEADER_HEIGHT,
              paddingHorizontal: 16,
              paddingVertical: spacing.sm,
              backgroundColor: c.background,
            }}
          >
            <SectionLabel weight="semibold">{title}</SectionLabel>
            {stickySection === title ? (
              <View
                style={{
                  position: 'absolute',
                  start: 0,
                  end: 0,
                  bottom: 0,
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: c.border,
                  pointerEvents: 'none',
                }}
              />
            ) : null}
          </View>
        )}
        renderItem={({ item }) => (
          <ContactListItem
            counterpartyPubkey={item.pubkey}
            displayName={item.displayName}
            secondaryName={item.secondaryName}
            picture={item.picture}
            onPress={() => onSelect(item.pubkey)}
            selected={selectedPubkeys ? selectedPubkeys.has(item.pubkey) : undefined}
            selectProgress={selectProgress}
          />
        )}
        onScrollToIndexFailed={() => {
          const pending = pendingJump.current;
          if (!pending || pending.attempts >= 5) {
            pendingJump.current = null;
            return;
          }
          pending.attempts += 1;
          // The failed scroll advanced toward the target and rendered more rows;
          // retry once layout has settled so the now-measured section can be
          // reached. Re-failure re-enters here until it lands or caps.
          setTimeout(() => scrollToSection(pending.sectionIndex), 50);
        }}
        contentContainerStyle={{ paddingBottom: contentBottomInset }}
      />

      {sections.length >= 1 ? <ContactIndexRail titles={indexTitles} onJump={jumpTo} /> : null}
    </View>
  );
});
