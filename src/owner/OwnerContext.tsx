import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';

export interface OwnerSession {
  /** Client mang phiên chủ tạm (chỉ trong bộ nhớ, tự thoát sau 2 phút không thao tác). */
  client: SupabaseClient;
  email: string;
  /** Quầy (hồ sơ tablet) của máy đang vào chế độ chủ. */
  tabletProfileId: string;
  /** Tên quầy của máy đang vào chế độ chủ. */
  tabletName: string;
  /** Thoát chế độ chủ, về màn bán hàng. */
  leave(): void;
}

export const OwnerContext = createContext<OwnerSession | null>(null);

export function useOwner(): OwnerSession {
  const s = useContext(OwnerContext);
  if (!s) throw new Error('useOwner() phải nằm trong OwnerContext');
  return s;
}
