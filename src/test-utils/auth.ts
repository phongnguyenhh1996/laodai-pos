import { AUTH_STORAGE_KEY } from '@/lib/supabase';

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** JWT giả (không ký) mang app_metadata như phiên Supabase thật. */
export function fakeJwt(claims: { role?: string; tablet_profile_id?: string; email?: string; exp?: number }): string {
  const { role, tablet_profile_id, email, exp = Math.floor(Date.now() / 1000) + 3600 } = claims;
  const payload = { sub: 'u', email, exp, role: 'authenticated', app_metadata: { role, tablet_profile_id } };
  return `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.sig`;
}

/** Ghi phiên vào localStorage đúng khóa mà supabase-js dùng cho client chính. */
export function storeSession(claims: Parameters<typeof fakeJwt>[0]): void {
  const access_token = fakeJwt(claims);
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      access_token,
      refresh_token: 'r',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u', email: claims.email, app_metadata: { role: claims.role, tablet_profile_id: claims.tablet_profile_id } },
    }),
  );
}
