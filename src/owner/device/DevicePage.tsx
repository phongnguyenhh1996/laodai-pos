import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, TriangleAlert } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { listTabletProfiles, switchTablet, type TabletProfileOption } from '@/lib/auth';
import { pos, tabletStore } from '@/lib/pos';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';

/**
 * `/owner/device`: đổi quầy cho máy đang dùng. Dùng luôn phiên chủ tạm (không đăng nhập lại).
 * Ca + đơn của quầy cũ vẫn nằm trên server; máy khác ở quầy cũ không bị ảnh hưởng.
 */
export function DevicePage() {
  const owner = useOwner();
  const navigate = useNavigate();
  const snap = useSyncExternalStore(tabletStore.subscribe, tabletStore.getSnapshot);
  const [profiles, setProfiles] = useState<TabletProfileOption[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listTabletProfiles(owner.client)
      .then((p) => alive && setProfiles(p))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [owner.client]);

  const target = profiles?.find((p) => p.id === picked) ?? null;
  const openShift = snap.open?.shift ?? null;

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await switchTablet(owner.client, target.id);
      // Bỏ danh mục / ca / đơn của quầy cũ trước khi màn bán hàng nạp quầy mới.
      tabletStore.reset();
      pos.reset();
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <OwnerLayout title="Quầy của máy này" back="/owner" testId="owner-device-page">
      <p className="text-ink-muted">
        Máy này đang bán ở <b className="text-ink">{owner.tabletName}</b>. Chọn quầy khác để chuyển máy sang quầy đó.
      </p>
      {!profiles ? (
        error ? <ErrorText testId="device-error">{error}</ErrorText> : <Splash />
      ) : (
        <>
          <div className="card flex flex-col divide-y divide-line overflow-hidden" data-testid="device-profiles">
            {profiles.map((p) => {
              const current = p.id === owner.tabletProfileId;
              const selected = p.id === picked;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={current || busy}
                  aria-pressed={selected}
                  onClick={() => setPicked(p.id)}
                  data-testid={`device-profile-${p.id}`}
                  className={`flex min-h-tap items-center justify-between gap-3 px-4 py-3 text-left text-lg font-medium transition-colors duration-fast ${
                    selected ? 'bg-brand-soft text-brand-strong' : current ? 'text-ink-subtle' : 'hover:bg-surface-muted active:bg-surface-sunken'
                  }`}
                >
                  <span>{p.name}</span>
                  {current ? (
                    <span className="badge bg-surface-sunken text-ink-muted">Đang dùng</span>
                  ) : (
                    selected && <Check aria-hidden className="h-5 w-5" />
                  )}
                </button>
              );
            })}
          </div>
          {profiles.length <= 1 && <p className="text-ink-subtle">Chưa có quầy nào khác. Thêm quầy trong Cài đặt → Quầy.</p>}
          {target && (
            <section className="card flex flex-col gap-3 p-5" data-testid="device-confirm">
              {openShift && (
                <p className="flex items-start gap-2 rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-warning-strong" data-testid="device-open-shift">
                  <TriangleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>
                    {owner.tabletName} đang có ca của {openShift.staff_name}. Ca và đơn vẫn giữ nguyên trên server: máy khác ở quầy này bán tiếp được,
                    hoặc chuyển máy này về lại quầy này để đóng ca.
                  </span>
                </p>
              )}
              <p className="text-lg">
                Chuyển máy này sang <b>{target.name}</b>? Sau khi chuyển, máy về màn bán hàng của quầy mới.
              </p>
              <ErrorText testId="device-error">{error}</ErrorText>
              <div className="flex gap-3">
                <button type="button" className="btn btn-secondary flex-1" disabled={busy} onClick={() => setPicked(null)} data-testid="device-cancel">
                  Thôi
                </button>
                <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => void confirm()} data-testid="device-switch">
                  {busy ? 'Đang chuyển…' : `Chuyển sang ${target.name}`}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </OwnerLayout>
  );
}
