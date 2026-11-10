import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, processColor, StyleSheet, View } from 'react-native';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import EllipsisVertical from 'lucide-react-native/icons/ellipsis-vertical';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/common/IconButton';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { platform } from '@/platform';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';
import { ApplicationNavigation, APPLICATION_NAVIGATION_WIDTH } from './ApplicationNavigation';

/** The task window manipulates only its handle; the document retains its own input path. */
export function ApplicationTaskControls({ taskId, active = true, enabled, canGoBack, canGoForward, onBack, onForward, onMore, menuEnabled }: {
  taskId?: string; active?: boolean;
  enabled: boolean; canGoBack: boolean; canGoForward: boolean; menuEnabled: boolean;
  onBack(): void; onForward(): void; onMore(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [offsetY, setOffsetY] = useState(0);
  const [tags, setTags] = useState<{ viewTag: number; handleTag: number }>();
  if (!active && expanded) setExpanded(false);
  const c = useThemeColors(), { t } = useTranslation();
  const size = uiDensity.headerActionSize, handleWidth = spacing.lg;
  const height = size + spacing.sm * 2;
  const travel = APPLICATION_NAVIGATION_WIDTH + spacing.xs + size + spacing.sm * 2;
  const drawer = useRef<View>(null), handle = useRef<View>(null);
  const layout = useCallback(() => {
    const viewTag = findNodeHandle(drawer.current), handleTag = findNodeHandle(handle.current);
    if (viewTag !== null && handleTag !== null) setTags(previous => previous?.viewTag === viewTag && previous.handleTag === handleTag ? previous : { viewTag, handleTag });
  }, []);
  const setOpen = useCallback((next: boolean) => setExpanded(next), []);
  useEffect(() => {
    if (!taskId) return;
    return platform.napplet.tasks?.onDrawerChange((id, next, y) => {
      if (id !== taskId) return;
      setExpanded(next);
      if (Number.isFinite(y)) setOffsetY(y);
    });
  }, [taskId]);
  useEffect(() => {
    if (!active || !expanded) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setOpen(false); return true; });
    return () => subscription.remove();
  }, [active, expanded, setOpen]);
  const feedbackColor = processColor(c.interactionOverlay);
  useEffect(() => {
    if (!taskId || !tags) return;
    void platform.napplet.tasks?.configureDrawer(taskId, { ...tags, active, expanded,
      travel, margin: spacing.sm, feedbackColor: typeof feedbackColor === 'number' ? feedbackColor : 0,
    }).catch(error => console.warn('[applications] Task drawer unavailable', error));
  }, [active, expanded, feedbackColor, tags, taskId, travel]);
  useEffect(() => {
    if (!taskId || !tags) return;
    const tasks = platform.napplet.tasks;
    return () => { void tasks?.releaseDrawer(taskId, tags.viewTag).catch(() => {}); };
  }, [tags, taskId]);
  const perform = (action: () => void) => { setOpen(false); action(); };
  return <View style={[StyleSheet.absoluteFill, {
    // The physical docking edge is independent of the document's reading direction.
    direction: 'ltr', overflow: 'hidden', pointerEvents: active ? 'box-none' : 'none', display: active ? 'flex' : 'none',
  }]}>
    {expanded && active ? <InteractivePressable testID="application-task-drawer-dismiss" accessible={false}
      hoverFeedback={false} onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} /> : null}
    <View ref={drawer} onLayout={layout} collapsable={false} testID="application-task-drawer" style={{
      position: 'absolute', end: 0, top: spacing.sm, height, width: travel + handleWidth,
      // Keep Fabric's hit-test geometry consistent with completed native manipulation.
      transform: [{ translateX: expanded ? 0 : travel }, { translateY: offsetY }], opacity: active ? 1 : 0,
      flexDirection: 'row', alignItems: 'center', borderTopStartRadius: radius.lg, borderBottomStartRadius: radius.lg,
      overflow: 'hidden', backgroundColor: c.surfaceHandle, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth,
    }}>
      <View ref={handle} onLayout={layout} collapsable={false} style={{ width: handleWidth, height }}>
        <IconButton width={handleWidth} height={height} shape="rectangle" hoverFeedback={false}
          accessibilityLabel={t('applications.runtime_more')} onPress={() => setOpen(!expanded)}
          icon={<EllipsisVertical size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.text} />} />
      </View>
      <View accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        style={{ height, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm,
          backgroundColor: c.surfaceElevated, pointerEvents: expanded ? 'auto' : 'none' }}>
        <ApplicationNavigation enabled={enabled} canGoBack={canGoBack} canGoForward={canGoForward}
          onBack={() => perform(onBack)} onForward={() => perform(onForward)} />
        <IconButton size={size} accessibilityLabel={t('applications.runtime_more')} disabled={!menuEnabled} onPress={() => perform(onMore)}
          icon={<Ellipsis size={uiDensity.headerActionIconSize} strokeWidth={iconStrokeWidth.default} color={c.text} />} />
      </View>
    </View>
  </View>;
}
