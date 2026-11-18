import { useEffect, useState, useSyncExternalStore } from 'react';
import { syncActivationName, type Activation } from '@/pos';
import { loadTabletActivation } from '@/lib/auth';
import { tabletStore } from '@/lib/pos';

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

/**
 * Tên quầy của máy, theo danh mục mới nhất từ server (chủ đổi tên ⇒ cập nhật ngay qua Realtime).
 * Chưa tải được danh mục ⇒ dùng tên lưu lúc kích hoạt; có tên mới ⇒ ghi lại xuống máy.
 */
export function useTabletName(activation: Activation): string {
  const snap = useSyncExternalStore(tabletStore.subscribe, tabletStore.getSnapshot);
  const profile = snap.catalog?.profile;
  const live = profile?.id === activation.tablet_profile_id ? profile.name : null;
  useEffect(() => {
    if (live) syncActivationName(activation.tablet_profile_id, live);
  }, [activation.tablet_profile_id, live]);
  return live ?? activation.tablet_name;
}
