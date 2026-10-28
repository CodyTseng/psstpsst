import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ApplicationPermissionsPage } from '@/components/napplet/ApplicationPermissionsPage';
import { NappletSettings } from '@/components/napplet/NappletPanel';
import { useNappletRelease } from '@/hooks/use-napplet-release';
import { spacing } from '@/theme';
import { applicationPresentation } from '@/services/explore/model';

export default function NappletPermissionsScreen() {
  const {id}=useLocalSearchParams<{id:string}>();
  const {release,installed,accountPubkey,error}=useNappletRelease(id);
  const {t}=useTranslation();
  const app=installed??release;
  return <ApplicationPermissionsPage application={app?applicationPresentation(app):undefined} error={error}>
    {app?installed&&accountPubkey?<NappletSettings key={`${accountPubkey}:${installed.eventKey}:${installed.hash}`} release={installed} accountPubkey={accountPubkey}/>
      :<View style={{gap:spacing.md}}>
        <AppText variant="subtitle">{t('applications.permissions')}</AppText>
        <ListGroup>{[...new Set([...app.required,...app.optional])].filter(domain=>domain!=='shell').map(domain=>
          <ListRow key={domain} title={t(`applications.capability_${domain}`,{defaultValue:domain})} value={t(app.required.includes(domain)?'applications.capabilities_required':'applications.capabilities_optional')}/>)}</ListGroup>
        {!app.required.length&&!app.optional.length?<AppText tone="muted">{t('applications.none')}</AppText>:null}
      </View>:null}
  </ApplicationPermissionsPage>;
}
