import type { ReactNode } from 'react';
import { ActivityIndicator,StyleSheet,View } from 'react-native';
import X from 'lucide-react-native/icons/x';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
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

/** Shared runtime chrome and status presentation; protocol lifetimes stay in route adapters. */
export function ApplicationRuntimePage({title,application,loading,error,hidden=false,windowed=false,menuEnabled,onClose,onMore,onRetry,children,overlay}:{
  title?:string;application?:ApplicationInfo;loading?:boolean;error?:string|null;hidden?:boolean;windowed?:boolean;menuEnabled:boolean;
  onClose():void;onMore():void;onRetry():void;children?:ReactNode;overlay?:ReactNode;
}) {
  const {t}=useTranslation(),c=useThemeColors(),clearance=useScreenHeaderClearance();
  const immersive = IS_ANDROID && !windowed;
  const contentTop = windowed || immersive ? 0 : clearance;
  const more = <IconButton size={uiDensity.headerActionSize}
    icon={<Ellipsis strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text}/>}
    accessibilityLabel={t('napplets.runtime_more')} onPress={onMore} disabled={!menuEnabled}/>;
  useDesktopWindowTitlebar(windowed ? { title, actions: more } : null);
  return <AppScreen edges={immersive ? ['top', 'bottom'] : ['bottom']}>
    <View style={{flex:1,display:hidden?'none':'flex'}}>
      {windowed || immersive ? null : <ScreenHeader title={title} back={false}
        left={<IconButton size={uiDensity.headerActionSize} icon={<X strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text}/>} accessibilityLabel={t('common.close')} onPress={onClose}/>}
        right={more}/>}

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
