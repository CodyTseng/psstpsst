import { useStore } from 'zustand';
import { discoveryStore } from '@/services/explore/discovery';
export function useDiscovery() { return useStore(discoveryStore); }
