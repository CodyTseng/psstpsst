import { applicationPresentation, type ApplicationInfo as ApplicationPresentation } from '@/services/explore/model';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ListRow } from '@/components/common/ListRow';
import { useDisplayName } from '@/hooks/use-display-name';
import type { NappletRelease } from '@/services/napplet/protocol';
import { spacing, useThemeColors } from '@/theme';
import { NappletIdentity } from './NappletIdentity';
import { NappletRequiredAccess } from './NappletRequiredAccess';

/** One information layout for details, runtime information and launch consent. */
export function NappletInfo({ release, onPublisher, notice }: { release: NappletRelease; onPublisher(): void; notice?: ReactNode }) {
  return <ApplicationInfo release={applicationPresentation(release)} onPublisher={onPublisher} notice={notice} />;
}

export function ApplicationInfo({release,onPublisher,notice,action,unsupported}:{release:ApplicationPresentation;onPublisher():void;notice?:ReactNode;action?:ReactNode;unsupported?:readonly string[]}) {
  const { t } = useTranslation();
  return <View testID="napplet-info" style={{ gap: spacing.lg }}>
    <NappletIdentity release={release} action={action} subtitle={release.kind ? t(`napplets.formats.${release.kind}`) : undefined} />
    {release.publisher?<PublisherRow pubkey={release.publisher} onPress={onPublisher}/>:null}
    {release.description.trim() ? <AppText>{release.description}</AppText> : null}
    {release.origin?<AppText variant="caption" tone="muted" selectable>{release.origin}</AppText>:null}
    {notice}
    <NappletRequiredAccess release={release} unsupported={unsupported} />
  </View>;
}
function PublisherRow({pubkey,onPress}:{pubkey:string;onPress:()=>void}) {
  const {t}=useTranslation();const c=useThemeColors();const {name,profile}=useDisplayName(pubkey);
  return <ListRow variant="inline" compact title={t('napplets.publisher')} titleTone="muted"
    value={name} valueTone="default" valueLeading={<Avatar pubkey={pubkey} picture={profile?.picture} size={spacing.xl}/>}
    trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted}/>} onPress={onPress}/>;
}
