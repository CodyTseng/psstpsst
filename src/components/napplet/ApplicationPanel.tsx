import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ApplicationInfo } from './NappletInfo';
import { ApplicationIdentity } from './ApplicationIdentity';
import type { ApplicationInfo as ApplicationPresentation } from '@/services/explore/model';
import { spacing } from '@/theme';

export function ApplicationPanel({application,page,settings,onPublisher}:{
  application:ApplicationPresentation;page:'about'|'settings';settings:ReactNode;onPublisher():void;
}) {
  return <View style={{gap:spacing.lg}}>
    {page==='about'?<ApplicationInfo release={application} onPublisher={onPublisher}/>:<>
      <ApplicationIdentity release={application} compact/>
      {settings}
    </>}
  </View>;
}
