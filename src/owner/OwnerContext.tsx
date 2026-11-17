import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';

export interface OwnerSession {
  /** Client mang phiên chủ: điện thoại = client chính; tablet = client tạm trong bộ nhớ. */
  client: SupabaseClient;
  email: string;
  /** `tablet`: chế độ chủ tạm trên tablet (tự thoát sau 2 phút); `phone`: thiết bị của chủ. */
  device: 'tablet' | 'phone';
  tabletName?: string;
  /** Thoát chế độ chủ (tablet) hoặc đăng xuất (điện thoại). */
  leave(): void;
}

export const OwnerContext = createContext<OwnerSession | null>(null);

export function useOwner(): OwnerSession {
  const s = useContext(OwnerContext);
  if (!s) throw new Error('useOwner() phải nằm trong OwnerContext');
  return s;
}
