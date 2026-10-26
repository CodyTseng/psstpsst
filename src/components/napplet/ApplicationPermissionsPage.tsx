import { useErrorToast } from '@/hooks/use-error-toast';
import type { ReactNode } from 'react';
import { ActivityIndicator,ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader,useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ApplicationPanel } from './ApplicationPanel';
import type { ApplicationInfo } from '@/services/explore/model';
import { spacing,useThemeColors } from '@/theme';

export function ApplicationPermissionsPage({application,error,children}:{application?:ApplicationInfo;error?:string;children?:ReactNode}) {
  const {t}=useTranslation(),c=useThemeColors(),clearance=useScreenHeaderClearance();
  useErrorToast(error);
  return <AppScreen edges={[]}>
    <ScreenHeader title={t('napplets.permissions_manage')}/>
    <ScrollView contentContainerStyle={{padding:spacing.lg,paddingTop:clearance,gap:spacing.xl}}>
      {application?<ApplicationPanel application={application} page="settings" settings={children} onPublisher={()=>{}}/>
        :!error?<ActivityIndicator color={c.accent}/>:null}
    </ScrollView>
  </AppScreen>;
}
