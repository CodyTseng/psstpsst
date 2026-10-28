import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  scrollTo, withTiming, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle,
  useAnimatedReaction, useDerivedValue, useFrameCallback, useSharedValue, type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { useTranslation } from 'react-i18next';
import { ListRow } from '@/components/common/ListRow';
import { AppText } from '@/components/common/AppText';
import type { ContextMenuAnchor, ContextMenuPlacement } from '@/components/common/ContextMenu';
import { useIsRTL } from '@/i18n/direction';
import { IS_ELECTRON, type DesktopContextMenuEvent } from '@/lib/platform';
import { impact } from '@/lib/haptics';
import { FAVORITES_PAGE_SIZE, type GridApp } from '@/services/explore/model';
import { spacing, useThemeColors } from '@/theme';
import { manipulationTiming } from '@/theme/motion';
import { NappletAppMenu } from './NappletAppMenu';
import { NappletRecentTile } from './NappletRecentTile';
import { NappletIcon } from './NappletIcon';
import { NappletTile, useNappletGridMetrics } from './NappletTile';

type Rect = { x: number; y: number; width: number; height: number };
type Source = 'recent' | 'desktop';
type Props<T extends GridApp = GridApp> = {
  header?: ReactNode;
  onScrollBeginDrag?: () => void;
  items: T[];
  visibleCount?: number;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  recent?: T[];
  onOpen: (app: T) => void;
  onMove: (app: T, index: number | null) => void | Promise<void>;
  bottomInset: number;
  onShowRecent?: () => void;
  onRemoveRecent?: (app: T) => void;
  onDetails: (app: T) => void;
  onPermissions: (app: T) => void;
  onShare: (app: T) => void;
  onScrollChange?: (scrolled: boolean) => void;
};
type Drag = {
  active: SharedValue<boolean>;
  sourceIndex: SharedValue<number>;
  releasedIndex: SharedValue<number>;
  previewBase: boolean;
  columns: number; columnStep: number; cellHeight: number; count: number; rtl: boolean;
  target: SharedValue<number>; selected: SharedValue<string>;
};

/** Constant-time preview mapping for each mounted cell; persistence waits for release. */
function previewSlot(index: number, drag: Drag): number {
  'worklet';
  const target = drag.target.get();
  if (!drag.previewBase || (!drag.active.get() && drag.releasedIndex.get() < 0) || target < 0) return index;
  const from = drag.sourceIndex.get();
  if (from < 0) return index === drag.count ? target : index >= target ? index + 1 : index;
  const to = Math.min(target, drag.count - 1);
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

function previewTransform(index: number, slot: number, drag: Drag) {
  'worklet';
  const dx = ((slot % drag.columns) - (index % drag.columns)) * drag.columnStep * (drag.rtl ? -1 : 1);
  const dy = (Math.floor(slot / drag.columns) - Math.floor(index / drag.columns)) * drag.cellHeight;
  return [
    { translateX: drag.previewBase && drag.active.get() ? withTiming(dx, manipulationTiming) : dx },
    { translateY: drag.previewBase && drag.active.get() ? withTiming(dy, manipulationTiming) : dy },
  ];
}

const EMPTY_RECENT: GridApp[] = [];

/** One virtualized drag surface for shortcuts, with an optional recent preview. */
export function NappletGrid<T extends GridApp>(props: Props<T>) {
  return <AppGrid {...props as unknown as Props} />;
}
function AppGrid({ header, onScrollBeginDrag, items, visibleCount: pageCount, loadingMore, onLoadMore, recent = EMPTY_RECENT, onOpen, onMove, bottomInset, onShowRecent, onRemoveRecent, onDetails, onPermissions, onShare, onScrollChange }: Props) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const rtl = useIsRTL();
  const root = useRef<View>(null);
  const viewport = useRef<View>(null);
  const list = useAnimatedRef<FlatList<GridApp>>();
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerSize = useSharedValue(0);
  const [width, setWidth] = useState(0);
  const [dragItems, setDragItems] = useState<Props['items'] | null>(null);
  const dropGeneration = useRef(0);
  const [dragging, setDragging] = useState<GridApp | null>(null);
  const [visibleCount, setVisibleCount] = useState(FAVORITES_PAGE_SIZE);
  const visibleItems = useMemo(() => items.slice(0, pageCount ?? visibleCount), [items, pageCount, visibleCount]);
  const [menu, setMenu] = useState<{ app: GridApp; source: Source; anchor: ContextMenuAnchor } | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<ContextMenuPlacement>('above');
  const appsByKey = useMemo(() => new Map([...recent, ...items].map((app) => [app.key, app])), [items, recent]);
  const suppressPress = useRef(false);
  const selectedIcon = useRef<View | null>(null);
  const selected = useSharedValue('');
  const sourceIndex = useSharedValue(-1);
  const releasedIndex = useSharedValue(-1);
  const origin = useSharedValue({ x: 0, y: 0 });
  const bounds = useSharedValue<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const x = useSharedValue(0), y = useSharedValue(0), active = useSharedValue(false);
  const loadMore = useCallback(() => {
    if (onLoadMore) { onLoadMore(); return; }
    setVisibleCount(count => Math.max(count, Math.min(items.length, count + FAVORITES_PAGE_SIZE)));
  }, [items.length, onLoadMore]);
  const offset = useSharedValue(0), contentHeight = useSharedValue(0);
  const { columns, iconSize, cellWidth, cellHeight, columnGap, columnStep, gridInset } = useNappletGridMetrics(width);
  const preview = useMemo(() => recent.slice(0, columns), [recent, columns]);
  const itemCount = items.length;
  const target = useDerivedValue(() => {
    if (!active.get()) return releasedIndex.get();
    const b = bounds.get(), px = x.get() - b.x - gridInset, py = y.get() - b.y;
    const contentY = py + offset.get() - headerSize.get();
    if (px < 0 || px > b.width - gridInset * 2 || py < 0 ||
        py > b.height - bottomInset || contentY < 0) return -1;
    const column = Math.min(columns - 1, Math.floor((px + columnGap / 2) / columnStep));
    const row = Math.max(0, Math.floor(contentY / cellHeight));
    return Math.min(itemCount, row * columns + (rtl ? columns - 1 - column : column));
  });
  const previewBase = useMemo(() => dragItems === null || dragItems === items ||
    dragItems.length === items.length && dragItems.every((app, index) => app.key === items[index].key), [dragItems, items]);
  const drag: Drag = useMemo(() => ({ active, target, selected, sourceIndex, releasedIndex, previewBase, columns, columnStep,
    cellHeight, count: itemCount, rtl }),
    [active, target, selected, sourceIndex, releasedIndex, previewBase, columns, columnStep, cellHeight, itemCount, rtl]);
  const finishDrop = useCallback(() => {
    dropGeneration.current++;
    releasedIndex.set(-1); active.set(false); selected.set('');
    setDragging(null); setDragItems(null);
  }, [releasedIndex, active, selected]);
  // New cells render without preview transforms in the same commit as their new order.
  useLayoutEffect(() => {
    // Retire the native preview before paint, once the committed cells own their positions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (dragItems !== null && !previewBase) finishDrop();
  }, [dragItems, previewBase, finishDrop]);
  const measure = useCallback(() => {
    root.current?.measureInWindow((px, py) => origin.set({ x: px, y: py }));
    viewport.current?.measureInWindow((px, py, w, h) => bounds.set({ x: px, y: py, width: w, height: h }));
  }, [origin, bounds]);
  useEffect(() => { measure(); }, [measure, recent.length, width]);
  useEffect(() => { offset.set(0); }, [columns, offset]);
  useAnimatedReaction(() => offset.get() > 0, (next, previous) => {
    if (onScrollChange && next !== previous) scheduleOnRN(onScrollChange, next);
  });
  const scroll = useAnimatedScrollHandler((event) => { offset.set(event.contentOffset.y); });
  // Edge scrolling and hit testing remain on the UI thread, including while JS is busy.
  const edgeScroll = useFrameCallback((frame) => {
    if (!active.get()) return;
    const b = bounds.get(), py = y.get() - b.y;
    if (x.get() < b.x || x.get() > b.x + b.width || py < 0 || py > b.height - bottomInset) return;
    const edge = spacing['3xl'];
    const direction = py < edge ? -1 : py > b.height - bottomInset - edge ? 1 : 0;
    if (!direction) return;
    const next = Math.max(0, Math.min(contentHeight.get() - b.height,
      offset.get() + direction * Math.min(frame.timeSincePreviousFrame ?? 16, 32) * 0.4));
    if (next !== offset.get()) { offset.set(next); scrollTo(list, 0, next, false); }
  }, false);
  useEffect(() => { edgeScroll.setActive(!!dragging); return () => edgeScroll.setActive(false); }, [edgeScroll, dragging]);
  const ghostStyle = useAnimatedStyle(() => {
    const released = releasedIndex.get();
    const column = released % columns;
    const physicalColumn = rtl ? columns - 1 - column : column;
    const b = bounds.get();
    const atDrop = released >= 0 && previewBase;
    return {
      opacity: active.get() ? 0.9 : atDrop ? 1 : 0,
      transform: [
        { translateX: atDrop ? b.x - origin.get().x + gridInset + physicalColumn * columnStep
          : x.get() - origin.get().x - cellWidth / 2 },
        { translateY: atDrop ? b.y - origin.get().y + headerSize.get() - offset.get()
          + Math.floor(released / columns) * cellHeight : y.get() - origin.get().y - cellHeight / 2 },
      ],
    };
  });
  const select = useCallback((app: GridApp, icon: View | null, index: number) => {
    if (releasedIndex.get() >= 0) return;
    selectedIcon.current = icon;
    suppressPress.current = false; selected.set(app.key);
    sourceIndex.set(index);
  }, [selected, sourceIndex, releasedIndex]);
  const begin = useCallback((key: string) => {
    const app = appsByKey.get(key);
    if (!app) return;
    dropGeneration.current++;
    suppressPress.current = true; setMenu(null); measure(); setDragItems(items); setDragging(app);
  }, [appsByKey, items, measure]);
  const end = useCallback((key: string, index: number, success: boolean) => {
    const app = appsByKey.get(key);
    if (!success || !app || index < 0) { finishDrop(); return; }
    const generation = dropGeneration.current;
    try {
      const saved = onMove(app, index);
      if (saved) void saved.then(() => {
        if (dropGeneration.current === generation) finishDrop();
      }, () => {
        if (dropGeneration.current === generation) finishDrop();
      });
    } catch {
      finishDrop();
    }
  }, [appsByKey, onMove, finishDrop]);
  const open = useCallback((app: GridApp) => {
    if (!suppressPress.current) onOpen(app);
  }, [onOpen]);
  const holdMenu = useCallback((key: string) => {
    const app = appsByKey.get(key);
    if (!app) return;
    suppressPress.current = true;
    selectedIcon.current?.measureInWindow((x, y, width, height) => {
      if (!IS_ELECTRON) impact('light');
      setMenuPlacement('above');
      setMenu({ app, source: 'desktop', anchor: { x, y, width, height } });
    });
  }, [appsByKey]);
  // The root owns the gesture so virtualizing its source cell cannot cancel a long drag.
  const pan = Gesture.Pan().onTouchesDown((event, manager) => {
    const touch = event.allTouches[0];
    if (menu || !touch || touch.absoluteY - bounds.get().y + offset.get() < headerSize.get()) manager.fail();
  }).activateAfterLongPress(IS_ELECTRON ? 0 : 450)
    // scheduleOnRN queues the ref-based measurement for this gesture event.
    // eslint-disable-next-line react-hooks/refs
    .onStart((event) => {
      if (!selected.get() || releasedIndex.get() >= 0) return;
      x.set(event.absoluteX); y.set(event.absoluteY);
      if (IS_ELECTRON) {
        active.set(true);
        scheduleOnRN(begin, selected.get());
      } else {
        scheduleOnRN(holdMenu, selected.get());
      }
    })
    // scheduleOnRN starts the ref-based drag lifecycle only after deliberate movement.
    // eslint-disable-next-line react-hooks/refs
    .onUpdate((event) => {
      if (!selected.get() || releasedIndex.get() >= 0) return;
      if (!active.get() && Math.hypot(event.translationX, event.translationY) < spacing.sm) return;
      x.set(event.absoluteX); y.set(event.absoluteY);
      if (!active.get()) { active.set(true); scheduleOnRN(begin, selected.get()); }
    })
    // scheduleOnRN defers the ref-based drop lifecycle to the gesture event.
    // eslint-disable-next-line react-hooks/refs
    .onFinalize((_event, success) => {
      if (!active.get()) return;
      const index = target.get();
      // Freeze the final preview until React commits the reordered cells.
      releasedIndex.set(success && index >= 0 ? Math.min(index, itemCount - (sourceIndex.get() >= 0 ? 1 : 0)) : -1);
      active.set(false);
      scheduleOnRN(end, selected.get(), index, success);
    });
  const showMenu = useCallback((app: GridApp, source: Source, event: DesktopContextMenuEvent, icon: View | null) => {
    event.preventDefault?.(); event.stopPropagation?.();
    selected.set('');
    icon?.measureInWindow((x, y, width, height) => { setMenuPlacement('above'); setMenu({ app, source, anchor: { x, y, width, height } }); });
  }, [selected]);
  const action = useCallback((app: GridApp, kind: string, index: number) => {
    if (kind === 'details') onDetails(app);
    else if (kind === 'permissions') onPermissions(app);
    else if (kind === 'share') onShare(app);
    else if (kind === 'add') void onMove(app, itemCount);
    else if (kind === 'remove') void onMove(app, null);
    else if (kind === 'earlier' && index > 0) void onMove(app, index - 1);
    else if (kind === 'later' && index >= 0 && index < itemCount - 1) void onMove(app, index + 1);
  }, [itemCount, onMove, onDetails, onPermissions, onShare]);
  const renderTile = (app: GridApp, source: Source, index: number) => <GridItem
    key={app.key} app={app} source={source} index={index}
    width={cellWidth} height={cellHeight} iconSize={iconSize} hideLabel={menu?.app.key === app.key && menuPlacement === 'below'} drag={drag}
    onOpen={open} onSelect={select} onMenu={showMenu} onAction={action} />;
  return <GestureDetector gesture={pan}><View ref={root} style={{ flex: 1 }} onLayout={(event) => {
    setWidth(Math.max(0, event.nativeEvent.layout.width - spacing.lg * 2)); measure();
  }}>
    <View ref={viewport} testID="napplet-desktop" style={{ flex: 1 }} onLayout={measure}>
      {width > 0 ? <Animated.FlatList
        ref={list} key={columns} data={visibleItems} numColumns={columns}
        onEndReached={loadMore} onEndReachedThreshold={0.25}
        ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={c.textMuted} style={{ padding: spacing.lg }} /> : null}
        keyExtractor={(item) => item.key}
        scrollEnabled={!dragging} onScrollBeginDrag={onScrollBeginDrag} onScroll={scroll} scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => contentHeight.set(h)}
        getItemLayout={(_data, index) => ({ length: cellHeight, offset: headerHeight + cellHeight * index, index })}
        initialNumToRender={24} removeClippedSubviews={false}
        columnWrapperStyle={columns > 1 ? { gap: columnGap } : undefined}
        contentContainerStyle={{ paddingHorizontal: gridInset, paddingBottom: bottomInset + spacing.lg }}
        ListHeaderComponent={<View onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          headerSize.set(height); setHeaderHeight(height);
        }}>
          {header ? <View style={{ marginHorizontal: -gridInset }}>{header}</View> : null}
          {recent.length && onShowRecent && onRemoveRecent ? <View testID="napplet-recent" style={{ paddingTop: spacing.sm, paddingBottom: spacing.lg }}>
            <View testID="napplet-recent-header" style={{ paddingHorizontal: spacing.lg - gridInset, overflow: 'hidden' }}>
              <ListRow variant="inline" title={t('napplets.recent')} titleTone="muted" onPress={onShowRecent}
                trailing={<ChevronRight size={spacing.lg} color={c.textMuted} style={rtl ? { transform: [{ scaleX: -1 }] } : undefined} />} />
            </View>
            <View style={{ flexDirection: 'row', gap: columnGap }}>
              {preview.map((app) => <NappletRecentTile key={app.key} app={app} testID={`recent-app-${app.key}`}
                width={cellWidth} height={cellHeight} iconSize={iconSize} onOpen={open}
                onAdd={(item) => { if (item.desktopPosition === null) void onMove(item, items.length); }}
                onUnfavorite={(app) => onMove(app, null)} onRemove={onRemoveRecent} onDetails={onDetails} onPermissions={onPermissions} onShare={onShare} />)}
            </View>
          </View> : null}
        </View>}
        renderItem={({ item, index }) => renderTile(item, 'desktop', index)}
      /> : null}
    </View>
    {/* Pointer coordinates use the physical window origin, including in RTL. */}
    {dragging ? <Animated.View accessible={false}
      style={[{ position: 'absolute', top: 0, left: 0, width: cellWidth, height: cellHeight,
        alignItems: 'center', justifyContent: 'center', gap: spacing.sm, zIndex: 100 }, ghostStyle, { pointerEvents: 'none' }]}>
      <NappletIcon release={dragging} size={iconSize} />
      <AppText variant="caption" numberOfLines={1}>{dragging.title}</AppText>
    </Animated.View> : null}
    {menu ? <NappletAppMenu inline app={menu.app} anchor={menu.anchor} onClose={() => setMenu(null)}
      onPlacementChange={setMenuPlacement} onDetails={onDetails} onPermissions={onPermissions} onShare={onShare}
      favorite onFavorite={(app) => action(app, 'remove', -1)} /> : null}

  </View></GestureDetector>;
}

const GridItem = memo(function GridItem({ app, source, index, width, height, iconSize, hideLabel, drag, onOpen, onSelect, onMenu, onAction }: {
  app: GridApp; source: Source; index: number; width: number; height: number; iconSize: number; hideLabel: boolean; drag: Drag;
  onOpen: Props['onOpen']; onSelect: (app: GridApp, icon: View | null, index: number) => void;
  onMenu: (app: GridApp, source: Source, event: DesktopContextMenuEvent, icon: View | null) => void;
  onAction: (app: GridApp, kind: string, index: number) => void;
}) {
  const { t } = useTranslation();
  const icon = useRef<View>(null);
  const appKey = app.key;
  const style = useAnimatedStyle(() => ({
    opacity: drag.previewBase && drag.selected.get() === appKey
      ? drag.active.get() ? 0.25 : drag.releasedIndex.get() >= 0 ? 0 : 1 : 1,
    transform: source === 'desktop' ? previewTransform(index, previewSlot(index, drag), drag) : [],
  }));
  return <Animated.View testID={`${source}-app-${app.key}`} style={[{ width, height, paddingVertical: spacing.sm }, style]}>
      <View style={{ flex: 1 }} onPointerDown={() => onSelect(app, icon.current, index)} onTouchStart={() => onSelect(app, icon.current, index)} {...(IS_ELECTRON ? {
        onContextMenu: (event: DesktopContextMenuEvent) => onMenu(app, source, event, icon.current),
      } : {})}>
        <NappletTile app={app} iconSize={iconSize} iconRef={icon} hideLabel={hideLabel}
          accessibilityActions={source === 'recent' ? [{ name: 'add', label: t('napplets.add_app') }] : [
            { name: 'details', label: t('napplets.details') },
            { name: 'permissions', label: t('napplets.permissions_manage') },
            { name: 'share', label: t('share.title') },
            { name: 'earlier', label: t('napplets.move_earlier') },
            { name: 'later', label: t('napplets.move_later') },
            { name: 'remove', label: t('napplets.remove_app') },
          ]}
          onAccessibilityAction={(event) => onAction(app, event.nativeEvent.actionName, index)}
          onPress={() => onOpen(app)} />
      </View>
    </Animated.View>;
});
