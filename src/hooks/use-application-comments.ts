import { useMemo, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useStore } from 'zustand';
import { ApplicationCommentsSession } from '@/services/explore/comments';
import type { CommentTarget } from '@/services/explore/comments-protocol';

export function useApplicationComments(account: string, target: CommentTarget) {
  const session = useMemo(() => new ApplicationCommentsSession(account, target), [account, target]);
  useFocusEffect(useCallback(() => { session.start(); return () => session.stop(); }, [session]));
  const state = useStore(session.store);
  return { ...state, session };
}
