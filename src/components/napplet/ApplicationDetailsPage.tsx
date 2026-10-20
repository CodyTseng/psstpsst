import { ActivityIndicator,ScrollView,View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader,useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useScrolled } from '@/hooks/use-scrolled';
import { ApplicationInfo } from './NappletInfo';
import { ApplicationComments } from './ApplicationComments';
import { ApplicationDetailsActions } from './ApplicationDetailsActions';
import type { ExploreEntry, ApplicationInfo as ApplicationPresentation } from '@/services/explore/model';
import { spacing,useThemeColors } from '@/theme';

/** One details layout for every Explore format; adapters supply data and actions. */
export function ApplicationDetailsPage({application,error,access,unsupported=false,onPublisher,onOpen,discussion,actions}:{
  application?:ApplicationPresentation;error?:string;
  access:{loaded:boolean;approved:boolean};unsupported?:boolean;
  onPublisher():void;onOpen():void;
  discussion?:{entry:ExploreEntry;account:string};
  actions?:{entry:ExploreEntry;onShare?:()=>void};
}) {
  const {t}=useTranslation(),c=useThemeColors(),clearance=useScreenHeaderClearance();
  const {scrolled,scrollProps}=useScrolled({resetKey:discussion?`${discussion.account}:${discussion.entry.key}`:undefined});
  const header=<View style={{padding:spacing.lg,paddingTop:clearance+spacing.lg,gap:spacing.xl}}>
    {error?<AppText tone="danger">{t(error)}</AppText>:null}
    {application?<ApplicationInfo release={application} onPublisher={onPublisher}
      action={<AppButton variant="primary" fullWidth={false} size="sm"
        label={t(access.loaded&&!access.approved?'napplets.allow_and_open':'napplets.open')}
        disabled={unsupported||!access.loaded} onPress={onOpen}/>}
      notice={unsupported||access.loaded&&!access.approved?<View style={{gap:spacing.sm}}>
        {unsupported?<AppText tone="danger">{t('napplets.unsupported')}</AppText>:null}
        {access.loaded&&!access.approved?<AppText variant="caption" tone="muted">{t('napplets.capabilities_signing_notice')}</AppText>:null}
      </View>:undefined}/>
      :!error?<ActivityIndicator color={c.accent}/>:null}
  </View>;
  return <AppScreen edges={['bottom']}>
    <ScreenHeader title={application?.title??t('napplets.details')} bordered={scrolled}
      right={application&&actions?<ApplicationDetailsActions key={actions.entry.key} {...actions}/>:undefined}/>
    {application&&discussion?<ApplicationComments entry={discussion.entry} account={discussion.account} header={header} scrollProps={scrollProps}/>
      :<ScrollView style={{flex:1}} {...scrollProps}>{header}</ScrollView>}
  </AppScreen>;
}
