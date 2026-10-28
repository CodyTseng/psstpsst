import type { ExploreEntry } from '@/services/explore/model';
import { useApplicationMembership } from '@/hooks/use-application-membership';
import { useErrorToast } from '@/hooks/use-error-toast';
import { useApplicationFavorite } from '@/hooks/use-application-favorite';
import { ApplicationMembershipButton } from './ApplicationMembershipButton';
import type { ReactNode } from 'react';

/** Details expose current account membership without launching the application. */
export function ApplicationDetailsMembership({ entry, account, children }: { entry: ExploreEntry; account: string;
  children?: (action: ReactNode, ready: boolean) => ReactNode;
}) {
  const { added, error } = useApplicationMembership(account, entry);
  useErrorToast(error ? 'applications.request_failed' : undefined, 'detail');
  const setMembership = useApplicationFavorite(account, 'detail');
  const action=<ApplicationMembershipButton key="membership" added={added} onChange={added => setMembership(entry, added)} />;
  return children?children(action,added!==undefined||!!error):action;
}
