import { useErrorToast } from '@/hooks/use-error-toast';
import { useState } from 'react';
import { ActivityIndicator,View } from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
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
  const [expanded,setExpanded]=useState(false);
  useErrorToast(failed && 'napplets.request_failed');
  const visibleRequired=required.filter(domain=>domain!=='shell');
  const label=(domain:string)=>t(`napplets.capability_${({network:'resource',common:'relay'} as Record<string,string>)[domain]??domain}`,{defaultValue:domain});
  return <View style={{gap:spacing.md}}>
    <AppText variant="subtitle">{t('napplets.permissions_access')}</AppText>
    {optional.length?<AppText variant="caption" tone="muted">{t('napplets.permissions_access_hint')}</AppText>:null}
    {!selected&&!failed?<ActivityIndicator color={c.accent}/>:null}
    {selected&&optional.length?<>
      <ListGroup>{optional.map(domain=><ListRow key={domain} title={label(domain)} trailing={<Toggle value={selected.includes(domain)} disabled={busy}
        onValueChange={value=>onToggle?.(domain,value)}/>}/>)}</ListGroup>
      {changed&&onSave?<AppButton label={t('napplets.permissions_save')} loading={busy} onPress={onSave}/>:null}
    </>:null}
    {visibleRequired.length?<>
      <AppButton variant="text" compact compactAxis="none" labelVariant="caption" label={t('napplets.capabilities_required')}
        accessibilityState={{expanded}} iconRight={expanded?<ChevronUp size={spacing.lg} color={c.text}/>:<ChevronDown size={spacing.lg} color={c.text}/>}
        onPress={()=>setExpanded(value=>!value)}/>
      {expanded?<ListGroup>{visibleRequired.map(domain=><ListRow key={domain} title={label(domain)} value={t('napplets.capabilities_required')} valueTone="muted"/>)}</ListGroup>:null}
    </>:null}
  </View>;
}
