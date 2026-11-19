import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearOwnerPinToken,
  deviceId,
  newOwnerPinToken,
  readActivation,
  readOwnerPinToken,
  writeActivation,
  writeOwnerPinToken,
  type Activation,
} from '@/pos';
import { readLegacy } from '@/pos/legacy';
import { createEphemeralClient, decodeClaims, storedClaims, supabase } from './supabase';

export type AuthErrorCode = 'bad_credentials' | 'not_owner' | 'offline' | 'server' | 'wrong_pin' | 'pin_locked' | 'pin_missing';

const MESSAGES: Record<AuthErrorCode, string> = {
  bad_credentials: 'Sai email hoặc mật khẩu.',
  not_owner: 'Tài khoản này không phải tài khoản chủ.',
  wrong_pin: 'Sai mã PIN.',
  pin_locked: 'Sai mã PIN quá nhiều lần. Mã PIN của máy này đã bị xóa, hãy nhập mật khẩu chủ.',
  pin_missing: 'Máy này không còn mã PIN (đã bị xóa). Hãy nhập mật khẩu chủ.',
  offline: 'Không có mạng. Cần mạng để đăng nhập chủ.',
  server: 'Máy chủ lỗi, thử lại sau.',
};

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    detail?: string,
    /** Sai PIN: còn bao nhiêu lần thử trước khi PIN của máy bị xóa. */
    public remaining?: number,
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
}

/**
 * Kích hoạt tablet (mục 1.2): Edge Function cấp phiên vai trò `tablet` cho hồ sơ đã chọn,
 * sau đó phiên chủ trên máy này bị hủy (đăng xuất phía server), phiên `tablet` được lưu làm phiên chính.
 */
export async function activateTablet(
  owner: SupabaseClient,
  profileId: string,
  now = () => new Date(),
  opts: { replaceCurrent?: boolean } = {},
): Promise<Activation> {
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
  // Đổi quầy: thu hồi phiên quầy cũ của riêng máy này (máy khác cùng quầy cũ không bị ảnh hưởng).
  if (opts.replaceCurrent) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);

  const { error } = await supabase.auth.setSession(res.session);
  if (error) throw toAuthError(error);

  const activation: Activation = {
    tablet_profile_id: res.profile.id,
    tablet_name: res.profile.name,
    activated_at: now().toISOString(),
    owner_email: ownerEmail,
  };
  // Ca + đơn đang mở nằm trên server: máy mới kích hoạt (kể cả máy thứ hai của cùng hồ sơ) thấy ngay.
  writeActivation(activation);
  return activation;
}

/**
 * Chế độ chủ: chuyển máy này sang quầy khác (dùng phiên chủ tạm đang mở, không cần đăng nhập lại).
 * Ca + đơn của quầy cũ nằm nguyên trên server; máy khác đang ở quầy cũ vẫn bán bình thường.
 * Phiên chủ tạm bị hủy ⇒ sau khi đổi, máy về màn bán hàng của quầy mới.
 */
export function switchTablet(owner: SupabaseClient, profileId: string): Promise<Activation> {
  return activateTablet(owner, profileId, undefined, { replaceCurrent: true });
}

/**
 * Máy này có phải tablet đã kích hoạt không: phải có cả hồ sơ kích hoạt trên máy
 * lẫn phiên vai trò `tablet` của đúng hồ sơ đó. Chép hồ sơ kích hoạt sang máy khác không đủ để vào màn bán hàng.
 * Máy đang chạy bản offline cũ: lấy hồ sơ kích hoạt từ IndexedDB cũ sang.
 */
export async function loadTabletActivation(): Promise<Activation | null> {
  let a = readActivation();
  if (!a) {
    a = (await readLegacy().catch(() => null))?.activation ?? null;
    if (a) writeActivation(a);
  }
  if (!a) return null;
  const c = storedClaims();
  if (c?.role !== 'tablet' || c.tablet_profile_id !== a.tablet_profile_id) return null;
  return a;
}

/**
 * Vào chế độ chủ trên tablet: nhập lại mật khẩu chủ ⇒ phiên chủ tạm (bộ nhớ) + ghi nhật ký;
 * báo Telegram chỉ lần đầu trên máy này (server nhớ mã thiết bị).
 */
export async function enterOwnerModeOnTablet(activation: Activation, password: string): Promise<SupabaseClient> {
  return markOwnerModeEntered(activation, await signInOwnerEphemeral(activation.owner_email, password));
}

async function markOwnerModeEntered(activation: Activation, owner: SupabaseClient): Promise<SupabaseClient> {
  const { error } = await owner.rpc('owner_mode_entered', {
    p_profile: activation.tablet_profile_id,
    p_device: deviceId(),
  });
  if (error) {
    await owner.auth.signOut({ scope: 'local' }).catch(() => undefined);
    throw toAuthError(error);
  }
  return owner;
}

/** Thoát chế độ chủ: thu hồi phiên tạm; không chờ mạng (mất mạng vẫn thoát được ngay). */
export function exitOwnerMode(owner: SupabaseClient): void {
  void owner.auth.signOut({ scope: 'local' }).catch(() => undefined);
}

// ---------------------------------------------------------------- mã PIN chế độ chủ (theo thiết bị)

/** Máy này đã cài mã PIN chế độ chủ chưa (theo khóa thiết bị đang giữ; server có thể đã xóa). */
export function hasOwnerPin(): boolean {
  return readOwnerPinToken() !== null;
}

/** Cài / đổi mã PIN chế độ chủ cho máy này (cần phiên chủ đang mở). Mỗi lần cài sinh khóa thiết bị mới. */
export async function setupOwnerPin(owner: SupabaseClient, activation: Activation, pin: string): Promise<void> {
  const token = newOwnerPinToken();
  const { error } = await owner.rpc('owner_set_device_pin', {
    p_token: token,
    p_pin: pin,
    p_device: deviceId(),
    p_profile: activation.tablet_profile_id,
  });
  if (error) throw toAuthError(error);
  writeOwnerPinToken(token);
}

/** Bỏ mã PIN của máy này (phía server + khóa trên máy). */
export async function removeOwnerPinOnThisDevice(owner: SupabaseClient): Promise<void> {
  const token = readOwnerPinToken();
  if (token) {
    const { error } = await owner.rpc('owner_remove_device_pin', { p_token: token });
    if (error) throw toAuthError(error);
  }
  clearOwnerPinToken();
}

export interface OwnerPinDevice {
  id: string;
  device_id: string | null;
  tablet_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function listOwnerPinDevices(owner: SupabaseClient): Promise<OwnerPinDevice[]> {
  const { data, error } = await owner.rpc('owner_list_device_pins');
  if (error) throw toAuthError(error);
  return (data ?? []) as OwnerPinDevice[];
}

/** Xóa PIN của một máy khác (máy mất / không dùng nữa): máy đó phải nhập lại mật khẩu chủ. */
export async function removeOwnerPinDevice(owner: SupabaseClient, id: string): Promise<void> {
  const { error } = await owner.rpc('owner_remove_device_pin', { p_id: id });
  if (error) throw toAuthError(error);
}

interface PinUnlockResponse {
  session: { access_token: string; refresh_token: string };
}

/**
 * Vào chế độ chủ bằng mã PIN của máy: server kiểm PIN (sai 5 lần ⇒ xóa PIN) rồi cấp phiên chủ tạm (bộ nhớ).
 * PIN không còn trên server ⇒ bỏ khóa trên máy, báo `pin_missing` / `pin_locked` để quay về nhập mật khẩu.
 */
export async function enterOwnerModeWithPin(activation: Activation, pin: string): Promise<SupabaseClient> {
  const token = readOwnerPinToken();
  if (!token) throw new AuthError('pin_missing');
  let res: PinUnlockResponse;
  try {
    const { data, error } = await supabase.functions.invoke<PinUnlockResponse>('owner-pin-unlock', { body: { token, pin } });
    if (error) throw await pinError(error);
    if (!data?.session) throw new Error('Thiếu phiên chủ');
    res = data;
  } catch (e) {
    const err = toAuthError(e);
    if (err.code === 'pin_locked' || err.code === 'pin_missing') clearOwnerPinToken();
    throw err;
  }
  const owner = createEphemeralClient();
  const { error } = await owner.auth.setSession(res.session);
  if (error) throw toAuthError(error);
  if (decodeClaims(res.session.access_token)?.role !== 'owner') {
    exitOwnerMode(owner);
    throw new AuthError('not_owner');
  }
  return markOwnerModeEntered(activation, owner);
}

/** Lỗi HTTP của Edge Function owner-pin-unlock → AuthError tương ứng. */
async function pinError(error: unknown): Promise<unknown> {
  const ctx = (error as { context?: Response }).context;
  if (!ctx || typeof ctx.json !== 'function') return error;
  const body = (await ctx.json().catch(() => null)) as { error?: string; remaining?: number } | null;
  switch (body?.error) {
    case 'wrong_pin':
      return new AuthError('wrong_pin', undefined, body.remaining);
    case 'pin_locked':
      return new AuthError('pin_locked');
    case 'pin_not_found':
      return new AuthError('pin_missing');
    default:
      return error;
  }
}
