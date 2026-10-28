import type { ExploreEntry } from '@/services/explore/model';
import { useApplicationMembership } from '@/hooks/use-application-membership';
import { useErrorToast } from '@/hooks/use-error-toast';
import { useApplicationFavorite } from '@/hooks/use-application-favorite';
import { ApplicationMembershipButton } from './ApplicationMembershipButton';

/** Details expose current account membership without launching the application. */
export function ApplicationDetailsMembership({ entry, account }: { entry: ExploreEntry; account: string }) {
  const { added, error } = useApplicationMembership(account, entry);
  useErrorToast(error ? 'napplets.request_failed' : undefined, 'detail');
  const setMembership = useApplicationFavorite(account, 'detail');
  return <ApplicationMembershipButton added={added} onChange={added => setMembership(entry, added)} />;
}
