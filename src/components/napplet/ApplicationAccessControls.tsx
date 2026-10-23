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
export function ApplicationAccessControls({required,optional=[],selected,failed=false,busy=false,changed=false,onToggle,onSave}:{
  required:string[];optional?:string[];selected?:string[];failed?:boolean;busy?:boolean;changed?:boolean;
  onToggle?(domain:string,enabled:boolean):void;onSave?():void;
}) {
  const {t}=useTranslation(),c=useThemeColors();
  useErrorToast(failed && 'napplets.request_failed');
  const visibleRequired=required.filter(domain=>domain!=='shell');
  const label=(domain:string)=>t(`napplets.capability_${({network:'resource',common:'relay'} as Record<string,string>)[domain]??domain}`,{defaultValue:domain});
  if(!visibleRequired.length&&!optional.length)return null;
  return <View style={{gap:spacing.xl}}>
    {visibleRequired.length?<View style={{gap:spacing.md}}>
      <AppText variant="subtitle">{t('napplets.capabilities_required')} · {visibleRequired.length}</AppText>
      <ListGroup>{visibleRequired.map(domain=><ListRow key={domain} title={label(domain)}
        value={t('napplets.capabilities_required')} valueTone="muted"/>)}</ListGroup>
    </View>:null}
    {optional.length?<View style={{gap:spacing.md}}>
      <AppText variant="subtitle">{t('napplets.capabilities_optional')} · {optional.length}</AppText>
      {!selected&&!failed?<ActivityIndicator color={c.accent}/>:null}
      {selected?<>
        <ListGroup>{optional.map(domain=>{
          const enabled=selected.includes(domain);
          return <ListRow key={domain} title={label(domain)}
            subtitle={t(enabled?'napplets.permissions_enabled':'napplets.permissions_disabled')}
            subtitleTone={enabled?'success':'muted'}
            trailing={<Toggle value={enabled} disabled={busy||!onToggle} accessibilityLabel={label(domain)}
              onValueChange={value=>onToggle?.(domain,value)}/>}/>;
        })}</ListGroup>
        {changed&&onSave?<AppButton label={t('napplets.permissions_save')} loading={busy} onPress={onSave}/>:null}
      </>:null}
    </View>:null}
  </View>;
}
