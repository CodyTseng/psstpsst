import { useContext, type ReactNode } from 'react';
import { ActivityIndicator,StyleSheet,View } from 'react-native';
import X from 'lucide-react-native/icons/x';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import { MaximizeSquareMinimalistic } from '@solar-icons/react-native/category/arrows-action/Linear/MaximizeSquareMinimalistic';
import { useTranslation } from 'react-i18next';
import { useDesktopWindowTitlebar } from '@/components/common/DesktopWindowFrame';
import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader,useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { IconButton } from '@/components/common/IconButton';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { NappletIcon } from './NappletIcon';
import type { ApplicationInfo } from '@/services/explore/model';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing,uiDensity,useThemeColors } from '@/theme';
import { IS_ANDROID } from '@/lib/platform';
import { platform } from '@/platform';
import { useNappletAppearance } from '@/platform/napplet-appearance';
import { ApplicationTaskContext } from './ApplicationTaskContext';

/** Shared runtime chrome and status presentation; protocol lifetimes stay in route adapters. */
export function ApplicationRuntimePage({title,application,containerId,active=true,loading,error,hidden=false,windowed=false,menuEnabled,openingWindow=false,onOpenWindow,onClose,onMore,onRetry,children,overlay}:{
  containerId?:string|null;active?:boolean;
  title?:string;application?:ApplicationInfo;loading?:boolean;error?:string|null;hidden?:boolean;windowed?:boolean;menuEnabled:boolean;
  openingWindow?:boolean;onOpenWindow?():void;
  onClose():void;onMore():void;onRetry():void;children?:ReactNode;overlay?:ReactNode;
}) {
  const {t}=useTranslation(),c=useThemeColors(),clearance=useScreenHeaderClearance();
  const taskId = useContext(ApplicationTaskContext);
  const immersive = IS_ANDROID && taskId !== null;
  const appearance = useNappletAppearance(containerId);
  const nativeWindow = windowed || !!platform.napplet.windows?.isHost;
  const contentTop = nativeWindow || immersive ? 0 : clearance;
  const more = <IconButton size={uiDensity.headerActionSize}
    icon={<Ellipsis strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text}/>}
    accessibilityLabel={t('napplets.runtime_more')} onPress={onMore} disabled={!menuEnabled || openingWindow}/>;
  const actions = onOpenWindow ? <View style={{flexDirection:'row',alignItems:'center',gap:spacing.xs}}>
    <IconButton size={uiDensity.headerActionSize}
      icon={<MaximizeSquareMinimalistic size={uiDensity.headerActionIconSize} color={c.text}/>}
      accessibilityLabel={t('napplets.open_in_new_window')} onPress={onOpenWindow} disabled={!menuEnabled || openingWindow}/>
    {more}
  </View> : more;
  useDesktopWindowTitlebar(nativeWindow && active ? { title, actions: more } : null);
  return <AppScreen edges={immersive ? ['top', 'bottom'] : ['bottom']}
    appearance={!loading && !error && !hidden ? appearance : undefined}
    statusBarActive={active} statusBarFollowsAppearance={immersive}>
    <View style={{flex:1,display:hidden?'none':'flex'}}>
      {nativeWindow || immersive ? null : <ScreenHeader title={title} back={false}
        left={<IconButton size={uiDensity.headerActionSize} icon={<X strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text}/>} accessibilityLabel={t('common.close')} onPress={onClose}/>}
        titleSideInset={onOpenWindow ? uiDensity.headerActionSize * 2 + spacing.xs + spacing.lg : undefined}
        right={actions}/>}

      <View style={{flex:1,marginTop:contentTop,overflow:'hidden'}}>
        {children}
        {loading&&!error?<View style={[StyleSheet.absoluteFill,{alignItems:'center',justifyContent:'center',padding:spacing.xl,gap:spacing.lg,backgroundColor:c.background}]}>
          {application?<NappletIcon release={application}/>:null}
          <ActivityIndicator color={c.accent}/>
          <AppText align="center" tone="muted">{t('napplets.runtime_loading')}</AppText>
        </View>:null}
        {error?<View style={{flex:1,alignItems:'center',justifyContent:'center',padding:spacing.xl,gap:spacing.lg}}>
          <AppText align="center" tone="muted">{t(error.startsWith('napplets.')?error:'napplets.request_failed')}</AppText>
          <View><AppButton fullWidth={false} label={t('common.retry')} onPress={onRetry}/></View>
        </View>:null}
      </View>
    </View>
    {overlay}
  </AppScreen>;
}
