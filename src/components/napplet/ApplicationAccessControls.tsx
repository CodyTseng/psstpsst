import { useErrorToast } from '@/hooks/use-error-toast';
import { ActivityIndicator,View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { Toggle } from '@/components/common/Toggle';
import { spacing,useThemeColors } from '@/theme';

/** Capability data varies by protocol; presentation and interaction remain shared. */
export function ApplicationAccessControls({required,optional=[],automatic=[],selected,failed=false,busy=false,changed=false,onToggle,onSave}:{
  required:string[];optional?:string[];automatic?:string[];selected?:string[];failed?:boolean;busy?:boolean;changed?:boolean;
  onToggle?(domain:string,enabled:boolean):void;onSave?():void;
}) {
  const {t}=useTranslation(),c=useThemeColors();
  useErrorToast(failed && 'applications.request_failed');
  const visibleRequired=required.filter(domain=>domain!=='shell');
  const label=(domain:string)=>t(`applications.capability_${({network:'resource'} as Record<string,string>)[domain]??domain}`,{defaultValue:domain});
  if(!visibleRequired.length&&!optional.length)return null;
  return <View style={{gap:spacing.lg}}>
    {visibleRequired.length?<View style={{gap:spacing.md}}>
      <AppText variant="caption" tone="muted">{t('applications.capabilities_required')}</AppText>
      <ListGroup>{visibleRequired.map(domain=><ListRow key={domain} title={label(domain)}/>)}</ListGroup>
    </View>:null}
    {optional.length?<View style={{gap:spacing.md}}>
      <AppText variant="caption" tone="muted">{t('applications.capabilities_optional')}</AppText>
      {!selected&&!failed?<ActivityIndicator color={c.accent}/>:null}
      {selected?<>
        <ListGroup>{optional.map(domain=>{
          const enabled=selected.includes(domain);
          return <ListRow key={domain} title={label(domain)}
            trailing={automatic.includes(domain)?<AppText variant="caption" tone="success">{t('applications.permissions_allow')}</AppText>:<Toggle value={enabled} disabled={busy||!onToggle} accessibilityLabel={label(domain)}
              onValueChange={value=>onToggle?.(domain,value)}/>}/>;
        })}</ListGroup>
        {changed&&onSave?<AppButton label={t('applications.permissions_save')} loading={busy} onPress={onSave}/>:null}
      </>:null}
    </View>:null}
  </View>;
}
