import { create } from 'zustand';

import {
  getDevicePreference,
  legacyWalletBalanceVisiblePreferenceKey,
  trySetDevicePreference,
  walletBalanceVisiblePreferenceKey,
} from '@/services/preferences/device-preferences.service';

type State = {
  visibleByAccount: Record<string, boolean>;
  load: (accountPubkey: string) => Promise<void>;
  isBalanceVisible: (accountPubkey: string | null | undefined) => boolean;
  setBalanceVisible: (accountPubkey: string, visible: boolean) => void;
};

export const useWalletPrefsStore = create<State>((set, get) => ({
  visibleByAccount: {},
  load: async (accountPubkey) => {
    const stored = await getDevicePreference(
      walletBalanceVisiblePreferenceKey(accountPubkey),
      legacyWalletBalanceVisiblePreferenceKey(accountPubkey),
    );
    set((state) => ({
      visibleByAccount: {
        ...state.visibleByAccount,
        [accountPubkey]: stored !== 'false',
      },
    }));
  },
  isBalanceVisible: (accountPubkey) => {
    if (!accountPubkey) return true;
    return get().visibleByAccount[accountPubkey] ?? false;
  },
  setBalanceVisible: (accountPubkey, visible) => {
    set((state) => ({
      visibleByAccount: {
        ...state.visibleByAccount,
        [accountPubkey]: visible,
      },
    }));
    void trySetDevicePreference(
      walletBalanceVisiblePreferenceKey(accountPubkey),
      visible ? 'true' : 'false',
    );
  },
}));
