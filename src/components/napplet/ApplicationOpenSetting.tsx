import { useErrorToast } from '@/hooks/use-error-toast';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { Toggle } from '@/components/common/Toggle';
import { useApplicationWindowPreference } from '@/hooks/use-application-window-preference';
import type { ExploreEntry } from '@/services/explore/model';
import { platform } from '@/platform';
import { spacing } from '@/theme';

export function ApplicationOpenSetting({ entry, account }: { entry: ExploreEntry; account: string }) {
  if (entry.kind === 'napp' || entry.kind === 'napplet') return null;
  if (!platform.napplet.windows && !platform.napplet.tasks) return null;
  return <ApplicationOpenPreference key={`${account}:${entry.kind}:${entry.address}`} entry={entry} account={account} />;
}

function ApplicationOpenPreference({ entry, account }: { entry: ExploreEntry; account: string }) {
  const { t } = useTranslation();
  const { value, saving, error, change } = useApplicationWindowPreference(entry, account);
  useErrorToast(error && 'napplets.request_failed');
  return <View style={{ gap: spacing.sm }}>
    <ListGroup><ListRow title={t('napplets.default_open_in_new_window')} loading={value === undefined && !error}
      trailing={value !== undefined ? <Toggle accessibilityLabel={t('napplets.default_open_in_new_window')} value={value} disabled={saving} onValueChange={next => { void change(next); }} /> : undefined} />
    </ListGroup>
  </View>;
}
