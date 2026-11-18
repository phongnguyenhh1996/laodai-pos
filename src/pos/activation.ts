import type { Activation } from './types';

/** Khóa localStorage giữ hồ sơ kích hoạt của máy (phiên `tablet` nằm ở khóa riêng của supabase-js). */
export const ACTIVATION_KEY = 'laodai-activation';

export function readActivation(storage: Storage | undefined = globalThis.localStorage): Activation | null {
  try {
    const raw = storage?.getItem(ACTIVATION_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<Activation>;
    return typeof a.tablet_profile_id === 'string' && typeof a.tablet_name === 'string' ? (a as Activation) : null;
  } catch {
    return null;
  }
}

export function writeActivation(a: Activation, storage: Storage | undefined = globalThis.localStorage): void {
  storage?.setItem(ACTIVATION_KEY, JSON.stringify(a));
}

export function clearActivation(storage: Storage | undefined = globalThis.localStorage): void {
  storage?.removeItem(ACTIVATION_KEY);
}
