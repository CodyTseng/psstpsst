import { useStore } from 'zustand';
import { nappletStore, nappletPermissionStore } from '@/services/napplet/service';

export function useNapplets() {
  return useStore(nappletStore);
}

export function useNappletPermissionRevision() {
  return useStore(nappletPermissionStore, (state) => state.revision);
}
export function useNappletAccountPubkey() {
  return useStore(nappletStore, (state) => state.accountPubkey);
}

/** Guard delayed UI actions against an account switch during sheet dismissal. */
export function getNappletAccountPubkey() {
  return nappletStore.getState().accountPubkey;
}
