import { useErrorToast } from '@/hooks/use-error-toast';
import { useState } from 'react';
import { ActivityIndicator,ScrollView,View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader,useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useScrolled } from '@/hooks/use-scrolled';
import { ApplicationInfo } from './NappletInfo';
import { ApplicationComments } from './ApplicationComments';
import { ApplicationOpenSetting } from './ApplicationOpenSetting';
import { ApplicationDetailsMembership } from './ApplicationDetailsMembership';
import { ApplicationDetailsActions } from './ApplicationDetailsActions';
import type { ExploreEntry, ApplicationInfo as ApplicationPresentation } from '@/services/explore/model';
import { spacing,useThemeColors } from '@/theme';

/** One details layout for every Explore format; adapters supply data and actions. */
export function ApplicationDetailsPage({application,error,access,unsupported=[],onPublisher,onOpen,discussion,actions}:{
  application?:ApplicationPresentation;error?:string;
  access:{loaded:boolean;approved:boolean};unsupported?:readonly string[];
  onPublisher():void;onOpen():void;
  discussion?:{entry:ExploreEntry;account:string};
  actions?:{entry:ExploreEntry;account?:string|null;onShare?:()=>void};
}) {
  const {t}=useTranslation(),c=useThemeColors(),clearance=useScreenHeaderClearance();
  useErrorToast(error);
  const {scrolled,scrollProps}=useScrolled({resetKey:discussion?`${discussion.account}:${discussion.entry.key}`:undefined});
  const identity=JSON.stringify([discussion?.account??actions?.account,discussion?.entry.key??actions?.entry.key??application?.title]);
  const [presented,setPresented]=useState<string>();
  const ready=!!application&&(access.loaded||!!error||presented===identity);
  if(application&&access.loaded&&presented!==identity)setPresented(identity);
  const openAction=<AppButton key="open" variant="primary" fullWidth={false} size="sm" label={t('napplets.open')}
    disabled={unsupported.length>0||!access.loaded} onPress={onOpen}/>;
  const membershipAction=actions?.account ? <ApplicationDetailsMembership key="membership" entry={actions.entry} account={actions.account} /> : null;
  const header=<View style={{padding:spacing.lg,paddingTop:clearance+spacing.lg,gap:spacing.xl}}>
    {ready?<ApplicationInfo release={application} onPublisher={onPublisher} unsupported={unsupported} actionPlacement="responsive"
      action={inline=><View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
        {inline ? [membershipAction,openAction] : [openAction,membershipAction]}
      </View>}/>
      :!error?<ActivityIndicator color={c.accent}/>:null}
    {ready && actions?.account ? <ApplicationOpenSetting entry={actions.entry} account={actions.account} /> : null}
  </View>;
  return <AppScreen edges={['bottom']}>
    <ScreenHeader title={ready?application.title:t('napplets.details')} bordered={scrolled}
      right={ready&&actions?<ApplicationDetailsActions key={actions.entry.key} {...actions}/>:undefined}/>
    {ready&&discussion?<ApplicationComments entry={discussion.entry} account={discussion.account} header={header} scrollProps={scrollProps}/>
      :<ScrollView style={{flex:1}} {...scrollProps}>{header}</ScrollView>}
  </AppScreen>;
}
