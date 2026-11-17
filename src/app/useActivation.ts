import { useEffect, useState } from 'react';
import type { Activation } from '@/sync/db';
import { getActivation } from '@/lib/localdb';

export type ActivationState = { status: 'loading' } | { status: 'none' } | { status: 'active'; activation: Activation };

export function useActivation(): ActivationState {
  const [state, setState] = useState<ActivationState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    getActivation()
      .then((a) => alive && setState(a ? { status: 'active', activation: a } : { status: 'none' }))
      .catch(() => alive && setState({ status: 'none' }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
