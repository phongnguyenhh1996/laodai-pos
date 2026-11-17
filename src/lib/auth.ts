import type { SupabaseClient } from '@supabase/supabase-js';
import { META, createSupabaseRestoreSource, restoreOpenState, setMeta, seedDeviceSeq, type Activation } from '@/sync';
import { createEphemeralClient, decodeClaims, storedClaims, supabase } from './supabase';
import { getActivation, localDb } from './localdb';

export type AuthErrorCode = 'bad_credentials' | 'not_owner' | 'offline' | 'server';

const MESSAGES: Record<AuthErrorCode, string> = {
  bad_credentials: 'Sai email hoặc mật khẩu.',
  not_owner: 'Tài khoản này không phải tài khoản chủ.',
  offline: 'Không có mạng. Cần mạng để đăng nhập chủ.',
  server: 'Máy chủ lỗi, thử lại sau.',
};

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    detail?: string,
  ) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
  }
}

function toAuthError(e: unknown): AuthError {
  if (e instanceof AuthError) return e;
  const err = e as { name?: string; status?: number; message?: string; code?: string } | null;
  const msg = err?.message ?? String(e);
  if (err?.code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return new AuthError('bad_credentials');
  if (
    err?.name === 'AuthRetryableFetchError' ||
    err?.name === 'FunctionsFetchError' ||
    err?.status === 0 ||
    /failed to fetch|networkerror|load failed/i.test(msg) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return new AuthError('offline');
  }
  return new AuthError('server', msg);
}

/** Đăng nhập chủ trên `client`; nếu tài khoản không phải chủ thì đăng xuất ngay và báo lỗi. */
export async function signInOwner(client: SupabaseClient, email: string, password: string): Promise<SupabaseClient> {
  let data;
  try {
    const r = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (r.error) throw r.error;
    data = r.data;
  } catch (e) {
    throw toAuthError(e);
  }
  if (decodeClaims(data.session.access_token)?.role !== 'owner') {
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    throw new AuthError('not_owner');
  }
  return client;
}

/** Phiên chủ chỉ trong bộ nhớ (kích hoạt tablet / chế độ chủ trên tablet). */
export function signInOwnerEphemeral(email: string, password: string): Promise<SupabaseClient> {
  return signInOwner(createEphemeralClient(), email, password);
}

export interface TabletProfileOption {
  id: string;
  name: string;
}

export async function listTabletProfiles(owner: SupabaseClient): Promise<TabletProfileOption[]> {
  const { data, error } = await owner.from('tablet_profiles').select('id,name').order('name');
  if (error) throw toAuthError(error);
  return data ?? [];
}

interface ActivateResponse {
  session: { access_token: string; refresh_token: string };
  profile: { id: string; name: string };
  last_device_seq: number;
}

/**
 * Kích hoạt tablet (mục 1.2): Edge Function cấp phiên vai trò `tablet` cho hồ sơ đã chọn,
 * sau đó phiên chủ trên máy này bị hủy (đăng xuất phía server), phiên `tablet` được lưu làm phiên chính.
 */
export async function activateTablet(owner: SupabaseClient, profileId: string, now = () => new Date()): Promise<Activation> {
  const { data: who } = await owner.auth.getSession();
  const ownerEmail = who.session?.user.email ?? '';
  let res: ActivateResponse;
  try {
    const { data, error } = await owner.functions.invoke<ActivateResponse>('activate-tablet', {
      body: { tablet_profile_id: profileId },
    });
    if (error) throw error;
    if (!data?.session) throw new Error('Thiếu phiên tablet');
    res = data;
  } catch (e) {
    throw toAuthError(e);
  }

  // Hủy phiên chủ trên máy này (thu hồi refresh token phía server).
  await owner.auth.signOut({ scope: 'local' }).catch(() => undefined);

  const { error } = await supabase.auth.setSession(res.session);
  if (error) throw toAuthError(error);

  const activation: Activation = {
    tablet_profile_id: res.profile.id,
    tablet_name: res.profile.name,
    activated_at: now().toISOString(),
    owner_email: ownerEmail,
  };
  await setMeta(localDb, META.activation, activation);
  await seedDeviceSeq(localDb, res.last_device_seq);
  // Server còn ca đang mở của hồ sơ này (máy mới / dữ liệu bị xóa) ⇒ lấy lại ca + đơn đang mở để đóng được ca.
  // Lỗi mạng ở bước này không chặn kích hoạt: máy vẫn bán được, nhưng chủ sẽ thấy ca cũ chưa đóng.
  await restoreOpenState(localDb, createSupabaseRestoreSource(supabase)).catch((e: unknown) => console.warn('Không khôi phục được ca đang mở', e));
  return activation;
}

/**
 * Máy này có phải tablet đã kích hoạt không: phải có cả hồ sơ kích hoạt trong IndexedDB
 * lẫn phiên vai trò `tablet` của đúng hồ sơ đó. Chép IndexedDB sang máy khác không đủ để vào màn bán hàng.
 */
export async function loadTabletActivation(): Promise<Activation | null> {
  const a = await getActivation();
  if (!a) return null;
  const c = storedClaims();
  if (c?.role !== 'tablet' || c.tablet_profile_id !== a.tablet_profile_id) return null;
  return a;
}

/** Vào chế độ chủ trên tablet: nhập lại mật khẩu chủ ⇒ phiên chủ tạm (bộ nhớ) + ghi nhật ký + báo Telegram. */
export async function enterOwnerModeOnTablet(activation: Activation, password: string): Promise<SupabaseClient> {
  const owner = await signInOwnerEphemeral(activation.owner_email, password);
  const { error } = await owner.rpc('owner_mode_entered', { p_profile: activation.tablet_profile_id });
  if (error) {
    await owner.auth.signOut({ scope: 'local' }).catch(() => undefined);
    throw toAuthError(error);
  }
  return owner;
}

/** Thoát chế độ chủ: thu hồi phiên tạm; không chờ mạng (offline vẫn thoát được ngay). */
export function exitOwnerMode(owner: SupabaseClient): void {
  void owner.auth.signOut({ scope: 'local' }).catch(() => undefined);
}
