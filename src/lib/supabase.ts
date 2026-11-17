import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anon);

/** Khóa localStorage của phiên chính (tablet: phiên vai trò `tablet`; điện thoại: phiên chủ). */
export const AUTH_STORAGE_KEY = 'laodai-auth';

/** Client chính: trên tablet giữ phiên vai trò `tablet`, trên điện thoại giữ phiên chủ. */
export const supabase = createClient(url ?? 'http://127.0.0.1:54321', anon ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY },
});

let ephemeralCount = 0;

/**
 * Client chỉ sống trong bộ nhớ, không ghi gì xuống máy. Dùng cho phiên chủ trên tablet
 * (kích hoạt và chế độ chủ): tải lại trang là mất phiên, phiên `tablet` không bị đụng tới.
 */
export function createEphemeralClient(): SupabaseClient {
  return createClient(url ?? 'http://127.0.0.1:54321', anon ?? 'missing-anon-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `laodai-ephemeral-${++ephemeralCount}`,
    },
  });
}

export interface AuthClaims {
  role: string | null;
  tablet_profile_id: string | null;
  email: string | null;
}

/** Đọc claim trong access token (không kiểm chữ ký: chỉ để điều hướng giao diện, server vẫn kiểm qua RLS). */
export function decodeClaims(accessToken: string): AuthClaims | null {
  try {
    const part = accessToken.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const p = JSON.parse(json) as { email?: string; app_metadata?: { role?: string; tablet_profile_id?: string } };
    return {
      role: p.app_metadata?.role ?? null,
      tablet_profile_id: p.app_metadata?.tablet_profile_id ?? null,
      email: p.email ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Claim của phiên chính đang lưu trên máy, đọc thẳng từ localStorage để chạy được cả khi offline
 * (token hết hạn vẫn đọc được; supabase-js sẽ tự làm mới khi có mạng).
 */
export function storedClaims(storage: Storage | undefined = globalThis.localStorage): AuthClaims | null {
  try {
    const raw = storage?.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { access_token?: string };
    return s.access_token ? decodeClaims(s.access_token) : null;
  } catch {
    return null;
  }
}
