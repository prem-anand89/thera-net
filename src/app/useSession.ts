import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

export interface SessionState {
  loading: boolean;
  session: Session | null;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ loading: true, session: null });

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setState({ loading: false, session: null });
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setState({ loading: false, session: data.session });
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ loading: false, session });
    });
    return () => subscription.unsubscribe();
  }, []);

  return state;
}
