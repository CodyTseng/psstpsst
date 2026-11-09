import { useApplicationUpdates, type ApplicationUpdateTarget } from '@/hooks/use-application-updates';
import { useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator,ScrollView,StyleSheet,View } from 'react-native';
import X from 'lucide-react-native/icons/x';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import { SquareTopDown } from '@solar-icons/react-native/category/arrows-action/Linear/SquareTopDown';
import { useTranslation } from 'react-i18next';
import { useDesktopWindowTitlebar } from '@/components/common/DesktopWindowFrame';
import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader,useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { IconButton } from '@/components/common/IconButton';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { AppProgressBar } from '@/components/common/AppProgressBar';
import { formatFileSize } from '@/lib/nostr/file-tags';
import type { ArtifactProgress } from '@/services/napplet/artifacts';
import { APPLICATION_ICON_SIZE, ApplicationIcon } from './ApplicationIcon';
import type { ApplicationInfo } from '@/services/explore/model';
import { iconStrokeWidth } from '@/theme/icons';
import { contentWidth,spacing,uiDensity,useThemeColors,ThemeColorsContext } from '@/theme';
import { useApplicationNavigation } from '@/hooks/use-application-navigation';
import { platform } from '@/platform';
import { useNappletAppearance } from '@/platform/napplet-appearance';
import { ApplicationNavigation, APPLICATION_NAVIGATION_WIDTH } from './ApplicationNavigation';
import { showToast } from '@/stores/toast.store';
import { ApplicationTaskContext } from './ApplicationTaskContext';
import { applicationChromeColors } from '@/theme/application-chrome';
import { IS_ANDROID } from '@/lib/platform';
import { ApplicationTaskControls } from './ApplicationTaskControls';

/** Shared runtime chrome and status presentation; protocol lifetimes stay in route adapters. */
export function ApplicationRuntimePage({title,application,containerId,active=true,loading,download,error,hidden=false,windowed=false,menuEnabled,showMenu=true,openingWindow=false,onOpenWindow,onClose,onBack,onForward,canReturnToParent=false,navigationBlocked=false,onMore,onRetry,children,overlay,update}:{
  update?:ApplicationUpdateTarget;
  containerId?:string|null;active?:boolean;
  title?:string;application?:ApplicationInfo;loading?:boolean;download?:ArtifactProgress;error?:string|null;hidden?:boolean;windowed?:boolean;menuEnabled:boolean;showMenu?:boolean;
  openingWindow?:boolean;onOpenWindow?():void;
  canReturnToParent?:boolean;navigationBlocked?:boolean;onBack?():void|Promise<void>;onForward?():void|Promise<void>;
  onClose():void;onMore():void;onRetry():void;children?:ReactNode;overlay?:ReactNode;
}) {
  const {t}=useTranslation(),c=useThemeColors(),clearance=useScreenHeaderClearance();
  useApplicationUpdates(update, active && !loading && !error && !hidden);
  const history = useApplicationNavigation(containerId);
  const taskId = useContext(ApplicationTaskContext);
  const navigating = useRef(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const navigationEnabled = !!onBack && !!onForward && !!containerId && active && !loading && !error && !hidden && !openingWindow && !navigationBlocked && !navigationPending;
  const navigate = async (action?: () => void | Promise<void>) => {
    if (!navigationEnabled || navigating.current || !action) return;
    navigating.current = true; setNavigationPending(true);
    try { await action(); }
    catch { showToast(t('applications.request_failed'), { variant: 'error' }); }
    finally { navigating.current = false; setNavigationPending(false); }
  };
  const canGoBack = history.canGoBack || canReturnToParent;
  const navigation = <ApplicationNavigation enabled={navigationEnabled} canGoBack={canGoBack} canGoForward={history.canGoForward}
    onBack={() => { if (canGoBack) void navigate(onBack); }} onForward={() => { if (history.canGoForward) void navigate(onForward); }} />;
  const documentAppearance = useNappletAppearance(containerId);
  const appearance = !loading && !error && !hidden ? documentAppearance : undefined;
  const chromeColors = useMemo(() => applicationChromeColors(c, appearance), [c, appearance]);
  const nativeWindow = windowed || !!platform.napplet.windows?.isHost;
  const androidTask = IS_ANDROID && taskId !== null;
  const showHeader = !nativeWindow && !androidTask;
  const contentTop = showHeader ? clearance : 0;
  const more = <IconButton size={uiDensity.headerActionSize}
    icon={<Ellipsis strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={chromeColors.text}/>}
    accessibilityLabel={t('applications.runtime_more')} onPress={onMore} disabled={!menuEnabled || openingWindow}/>;
  const actions = onOpenWindow && !nativeWindow && taskId === null ? <View style={{flexDirection:'row',alignItems:'center',gap:spacing.xs}}>
    <IconButton size={uiDensity.headerActionSize}
      icon={<SquareTopDown size={uiDensity.headerActionIconSize} color={chromeColors.text}/>}
      accessibilityLabel={t('applications.open_in_new_window')} onPress={onOpenWindow} disabled={!menuEnabled || openingWindow}/>
    {showMenu ? more : null}
  </View> : showMenu ? more : undefined;
  useDesktopWindowTitlebar(nativeWindow && active ? { title, actions: showMenu ? more : undefined, navigation, navigationWidth: APPLICATION_NAVIGATION_WIDTH, colors: chromeColors } : null);
  const taskControls = androidTask ? <ApplicationTaskControls taskId={taskId} active={active && !hidden && !navigationBlocked}
    enabled={navigationEnabled} canGoBack={canGoBack} canGoForward={history.canGoForward}
    onBack={() => { if (canGoBack) void navigate(onBack); }}
    onForward={() => { if (history.canGoForward) void navigate(onForward); }}
    menuEnabled={showMenu && menuEnabled && !openingWindow} onMore={onMore} /> : undefined;
  return <AppScreen edges={androidTask ? ['top', 'bottom'] : ['bottom']}
    appearance={appearance}
    windowOverlay={taskControls}
    statusBarActive={active}>
    <View style={{flex:1,display:hidden?'none':'flex'}}>
      {showHeader ? <ThemeColorsContext.Provider value={chromeColors}><ScreenHeader title={title} back={false}
        left={<View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <IconButton size={uiDensity.headerActionSize} icon={<X strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={chromeColors.text}/>} accessibilityLabel={t('common.close')} onPress={onClose}/>
          {navigation}
        </View>}
        titleSideInset={uiDensity.headerActionSize + spacing.xs + APPLICATION_NAVIGATION_WIDTH + spacing.lg}
        right={actions}/></ThemeColorsContext.Provider> : null}

      <View style={{flex:1,marginTop:contentTop,overflow:'hidden'}}>
        {children}
        {loading || error ? <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {application ? <ApplicationIcon release={application} /> : null}
          </View>
          <ScrollView showsVerticalScrollIndicator={false}
            style={{ position: 'absolute', top: '50%', marginTop: APPLICATION_ICON_SIZE / 2 + spacing.lg, bottom: 0, start: 0, end: 0 }}
            contentContainerStyle={{ alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg }}>
            {error ? <View style={{ width: '100%', maxWidth: contentWidth.sheet, alignItems: 'center', gap: spacing.lg }}>
              <AppText align="center" tone="danger" accessibilityRole="alert">
                {t(error.startsWith('applications.') ? error : 'applications.request_failed')}
              </AppText>
              <View><AppButton fullWidth={false} label={t('common.retry')} onPress={onRetry}/></View>
            </View> : download?.phase === 'downloading' && (download.received > 0 || (download.files?.ready ?? 0) > 0) ? <View style={{ width: '100%', maxWidth: contentWidth.sheet, gap: spacing.lg, alignItems: 'center' }}>
                <AppText align="center" tone="muted">{t('applications.runtime_downloading')}</AppText>
                {download.files ? <>
                  <AppProgressBar value={download.files.total ? download.files.ready / download.files.total : 0} label={t('applications.runtime_files_ready', download.files)} />
                  <AppText align="center" tone="muted" variant="caption">{t('applications.runtime_files_ready', download.files)}</AppText>
                </> : download.total ? <AppProgressBar value={download.received / download.total} label={t('applications.runtime_downloading')} /> : <ActivityIndicator color={c.accent} />}
                {download.received > 0 ? <AppText align="center" tone="muted" variant="caption">
                  {download.files ? t('applications.runtime_bytes_downloaded', { size: formatFileSize(download.received) }) : download.total
                    ? `${formatFileSize(download.received)} / ${formatFileSize(download.total)} · ${Math.min(100, Math.floor(download.received / download.total * 100))}%`
                    : formatFileSize(download.received)}
                </AppText> : null}
              </View> : <>
                <ActivityIndicator color={c.accent}/>
                <AppText align="center" tone="muted">{t(download?.phase === 'verifying' ? 'applications.runtime_verifying' : 'applications.runtime_loading')}</AppText>
            </>}
          </ScrollView>
        </View> : null}
      </View>
    </View>
    {overlay}
  </AppScreen>;
}
