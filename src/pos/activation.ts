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

/**
 * Chủ đổi tên quầy: cập nhật tên lưu trên máy (tên lưu lúc kích hoạt chỉ là bản chụp).
 * Chỉ ghi khi đúng hồ sơ đang kích hoạt và tên thật sự khác.
 */
export function syncActivationName(
  profileId: string,
  name: string,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  const a = readActivation(storage);
  if (!a || a.tablet_profile_id !== profileId || a.tablet_name === name) return;
  try {
    writeActivation({ ...a, tablet_name: name }, storage);
  } catch {
    /* không ghi được localStorage: lần sau vẫn hiện tên mới từ danh mục */
  }
}

export function clearActivation(storage: Storage | undefined = globalThis.localStorage): void {
  storage?.removeItem(ACTIVATION_KEY);
}

/** Khóa localStorage giữ mã thiết bị (không xóa khi đăng xuất / đổi quầy). */
export const DEVICE_ID_KEY = 'laodai-device-id';

/** Mã ngẫu nhiên nhận diện máy này: sinh lần đầu rồi giữ lại. Không dùng được localStorage ⇒ null. */
export function deviceId(storage: Storage | undefined = globalThis.localStorage): string | null {
  try {
    if (!storage) return null;
    let id = storage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      storage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
