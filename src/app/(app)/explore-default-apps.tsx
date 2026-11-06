import { DefaultApplicationsPage } from '@/components/napplet/DefaultApplicationsPage';
import { useActiveAccount } from '@/stores/active-account.store';

export default function ExploreDefaultAppsScreen() {
  const account = useActiveAccount(state => state.activePubkey);
  return <DefaultApplicationsPage key={account} account={account ?? ''} />;
}
