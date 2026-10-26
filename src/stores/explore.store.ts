import { useStore } from 'zustand';
import { exploreStore } from '@/services/explore/service';
export function useExplore() { return useStore(exploreStore); }

export const getExploreState = exploreStore.getState;
