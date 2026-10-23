import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { isPublisher, publisherCatalogue, type PublisherState } from '@/services/explore/publishers';

const empty = createStore<PublisherState>(() => ({ entries: [], loading: false, loaded: false, error: false }));

export function usePublisherApplications(pubkey?: string) {
  const catalogue = useMemo(() => isPublisher(pubkey) ? publisherCatalogue(pubkey) : undefined, [pubkey]);
  const state = useStore(catalogue?.store ?? empty);
  return { ...state, load: catalogue?.load };
}
