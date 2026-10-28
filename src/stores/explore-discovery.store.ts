import { useStore } from 'zustand';
import { getDiscoveryStore, type ApplicationDiscoveryScope } from '@/services/explore/discovery';
export function useDiscovery(scope: ApplicationDiscoveryScope = 'all') { return useStore(getDiscoveryStore(scope)); }
