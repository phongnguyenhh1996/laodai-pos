import { useEffect, useState } from 'react';
import type { Activation } from '@/pos';
import { loadTabletActivation } from '@/lib/auth';

export type ActivationState = { status: 'loading' } | { status: 'none' } | { status: 'active'; activation: Activation };

/** Trạng thái kích hoạt của máy (đọc một lần khi gắn component). */
export function useActivation(): ActivationState {
  const [state, setState] = useState<ActivationState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    loadTabletActivation()
      .then((a) => alive && setState(a ? { status: 'active', activation: a } : { status: 'none' }))
      .catch(() => alive && setState({ status: 'none' }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
