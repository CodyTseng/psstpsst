import { ActivityIndicator,ScrollView,StyleSheet,View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader,useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ApplicationInfo } from './NappletInfo';
import type { ApplicationInfo as ApplicationPresentation } from '@/services/explore/model';
import { spacing,useThemeColors } from '@/theme';

/** One details layout for every Explore format; adapters supply data and actions. */
export function ApplicationDetailsPage({application,error,access,unsupported=false,onPublisher,onOpen}:{
  application?:ApplicationPresentation;error?:string;
  access:{loaded:boolean;approved:boolean};unsupported?:boolean;
  onPublisher():void;onOpen():void;
}) {
  const {t}=useTranslation(),c=useThemeColors(),clearance=useScreenHeaderClearance();
  return <AppScreen edges={['bottom']}>
    <ScreenHeader title={application?.title??t('napplets.details')}/>
    <ScrollView style={{flex:1}} contentContainerStyle={{padding:spacing.lg,paddingTop:clearance+spacing.lg,gap:spacing.xl}}>
      {error?<AppText tone="danger">{t(error)}</AppText>:null}
      {application?<ApplicationInfo release={application} onPublisher={onPublisher}
        notice={unsupported?<AppText tone="danger">{t('napplets.unsupported')}</AppText>:undefined}/>
        :!error?<ActivityIndicator color={c.accent}/>:null}
    </ScrollView>
    {application?<View style={{padding:spacing.lg,backgroundColor:c.background,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:c.border}}>
      {access.loaded&&!access.approved?<AppText variant="caption" tone="muted" style={{paddingBottom:spacing.md}}>{t('napplets.capabilities_signing_notice')}</AppText>:null}
      <AppButton label={t(access.loaded&&!access.approved?'napplets.allow_and_open':'napplets.open')}
        disabled={unsupported||!access.loaded} onPress={onOpen}/>
    </View>:null}
  </AppScreen>;
}
