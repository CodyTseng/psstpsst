import { memo, useCallback, useRef, useState } from 'react';
import { FlatList, View, type GestureResponderEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Pin from 'lucide-react-native/icons/pin';
import PinOff from 'lucide-react-native/icons/pin-off';
import Trash from 'lucide-react-native/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { ContextMenu, type ContextMenuAnchor } from '@/components/common/ContextMenu';
import { IS_ELECTRON, type DesktopContextMenuEvent } from '@/lib/platform';
import type { NappletInstallation } from '@/services/napplet/protocol';
import { radius, spacing, useThemeColors } from '@/theme';
import { NappletIcon } from './NappletIcon';

type Action = 'pin' | 'unpin' | 'remove';
type Rect = { x: number; y: number; width: number; height: number };
type Props = {
  items: NappletInstallation[];
  onOpen: (app: NappletInstallation) => void;
  onAction: (app: NappletInstallation, action: Action) => void;
  bottomInset: number;
};
export function NappletGrid({ items, onOpen, onAction, bottomInset }: Props) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<NappletInstallation | null>(null);
  const [target, setTarget] = useState<Action | null>(null);
  const [menu, setMenu] = useState<{ app: NappletInstallation; anchor: ContextMenuAnchor } | null>(
    null,
  );
  const top = useRef<View>(null),
    bottom = useRef<View>(null);
  const rects = useRef<{ top?: Rect; bottom?: Rect }>({});
  const draggingRef = useRef<NappletInstallation | null>(null);
  const columns = Math.max(3, Math.min(6, Math.floor(width / (spacing['3xl'] * 2))));
  const hit = useCallback((x: number, y: number): Action | null => {
    const contains = (r?: Rect) =>
      !!r && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
    return contains(rects.current.bottom)
      ? 'remove'
      : contains(rects.current.top)
        ? draggingRef.current?.pinnedAt
          ? 'unpin'
          : 'pin'
        : null;
  }, []);
  const move = useCallback(
    (x: number, y: number) => {
      const next = hit(x, y);
      setTarget((old) => (old === next ? old : next));
    },
    [hit],
  );
  const begin = useCallback((app: NappletInstallation) => {
    draggingRef.current = app;
    setDragging(app);
  }, []);
  const end = useCallback(
    (x: number, y: number, success: boolean) => {
      const app = draggingRef.current;
      const action = hit(x, y);
      draggingRef.current = null;
      setDragging(null);
      setTarget(null);
      if (success && app && action) onAction(app, action);
    },
    [hit, onAction],
  );
  const measure = (which: 'top' | 'bottom') =>
    (which === 'top' ? top : bottom).current?.measureInWindow((x, y, w, h) => {
      rects.current[which] = { x, y, width: w, height: h };
    });
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flex: 1 }}>
      {width > 0 ? (
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(item) => item.key}
          scrollEnabled={!dragging}
          removeClippedSubviews={false}
          initialNumToRender={24}
          contentContainerStyle={{ padding: spacing.sm, paddingBottom: bottomInset + spacing.lg }}
          renderItem={({ item }) => (
            <GridItem
              app={item}
              columns={columns}
              onOpen={onOpen}
              onBegin={begin}
              onMove={move}
              onEnd={end}
              onMenu={(app, event) => {
                event.preventDefault?.();
                event.stopPropagation?.();
                setMenu({ app, anchor: { x: event.clientX ?? 0, y: event.clientY ?? 0 } });
              }}
              onAction={onAction}
            />
          )}
        />
      ) : null}
      {dragging ? (
        <>
          <View
            ref={top}
            onLayout={() => measure('top')}
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: spacing.sm,
              start: spacing.lg,
              end: spacing.lg,
              padding: spacing.lg,
              borderRadius: radius.lg,
              backgroundColor: c.accent,
              opacity: target === 'pin' || target === 'unpin' ? 1 : 0.8,
            }}
          >
            <AppText align="center" style={{ color: c.accentForeground }}>
              {t(dragging.pinnedAt ? 'napplets.unpin' : 'napplets.pin')}
            </AppText>
          </View>
          <View
            ref={bottom}
            onLayout={() => measure('bottom')}
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: bottomInset + spacing.sm,
              start: spacing.lg,
              end: spacing.lg,
              padding: spacing.lg,
              borderRadius: radius.lg,
              backgroundColor: c.danger,
              opacity: target === 'remove' ? 1 : 0.8,
            }}
          >
            <AppText align="center" style={{ color: c.accentForeground }}>
              {t('napplets.remove')}
            </AppText>
          </View>
        </>
      ) : null}
      {menu ? (
        <ContextMenu
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'pin',
              title: t(menu.app.pinnedAt ? 'napplets.unpin' : 'napplets.pin'),
              icon: menu.app.pinnedAt ? (
                <PinOff size={spacing.lg} color={c.text} />
              ) : (
                <Pin size={spacing.lg} color={c.text} />
              ),
              onPress: () => onAction(menu.app, menu.app.pinnedAt ? 'unpin' : 'pin'),
            },
            {
              key: 'remove',
              title: t('napplets.remove'),
              tone: 'danger',
              icon: <Trash size={spacing.lg} color={c.danger} />,
              onPress: () => onAction(menu.app, 'remove'),
            },
          ]}
        />
      ) : null}
    </View>
  );
}
const GridItem = memo(function GridItem({
  app,
  columns,
  onOpen,
  onBegin,
  onMove,
  onEnd,
  onMenu,
  onAction,
}: {
  app: NappletInstallation;
  columns: number;
  onOpen: Props['onOpen'];
  onBegin: (app: NappletInstallation) => void;
  onMove: (x: number, y: number) => void;
  onEnd: (x: number, y: number, success: boolean) => void;
  onMenu: (app: NappletInstallation, event: DesktopContextMenuEvent) => void;
  onAction: Props['onAction'];
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const x = useSharedValue(0),
    y = useSharedValue(0),
    active = useSharedValue(false);
  const pan = Gesture.Pan()
    .activateAfterLongPress(450)
    .runOnJS(true)
    .onStart(() => {
      active.value = true;
      onBegin(app);
    })
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY;
      onMove(e.absoluteX, e.absoluteY);
    })
    .onFinalize((e, success) => {
      if (active.value) onEnd(e.absoluteX, e.absoluteY, success);
      active.value = false;
      x.value = 0;
      y.value = 0;
    });
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: active.value ? 1.08 : 1 },
    ],
    zIndex: active.value ? 100 : 0,
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ width: `${100 / columns}%`, padding: spacing.xs }, style]}>
        <View
          {...(IS_ELECTRON
            ? { onContextMenu: (e: DesktopContextMenuEvent) => onMenu(app, e) }
            : {})}
        >
          <AppButton
            variant="ghost"
            compact
            label={app.title}
            labelVariant="caption"
            labelNumberOfLines={1}
            orientation="vertical"
            accessibilityRole="button"
            accessibilityLabel={app.title}
            accessibilityActions={[
              { name: 'pin', label: t(app.pinnedAt ? 'napplets.unpin' : 'napplets.pin') },
              { name: 'remove', label: t('napplets.remove') },
            ]}
            onAccessibilityAction={(e) =>
              onAction(
                app,
                e.nativeEvent.actionName === 'remove' ? 'remove' : app.pinnedAt ? 'unpin' : 'pin',
              )
            }
            onPress={(_e: GestureResponderEvent) => {
              if (!active.get()) onOpen(app);
            }}
            iconLeft={
              <View>
                <NappletIcon release={app} />
                {app.pinnedAt ? (
                  <View
                    style={{
                      position: 'absolute',
                      end: 0,
                      bottom: 0,
                      backgroundColor: c.surface,
                      borderRadius: radius.full,
                      padding: spacing.xs,
                    }}
                  >
                    <Pin size={spacing.md} color={c.accent} />
                  </View>
                ) : null}
              </View>
            }
          />
        </View>
      </Animated.View>
    </GestureDetector>
  );
});
