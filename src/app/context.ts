import { createContext, useContext } from 'react';
import type { Profile, Tour } from '../lib/types';
import { useMembers, useTourData } from './hooks';
import { invalidate } from './query';

export interface AppState {
  me: Profile;
  tour: Tour | null;
  tours: Tour[];
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext fehlt');
  return ctx;
}

/** Daten der gewählten Rundfahrt + Mitglieder. */
export function useTourContext() {
  const app = useApp();
  const tourQuery = useTourData(app.tour);
  const membersQuery = useMembers();
  return {
    ...app,
    data: tourQuery.data,
    members: membersQuery.data,
    loading: tourQuery.loading || membersQuery.loading,
    error: tourQuery.error ?? membersQuery.error,
    reload: () => {
      invalidate('tour:');
      invalidate('members');
    },
  };
}
