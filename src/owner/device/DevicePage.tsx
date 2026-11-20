import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, KeyRound, TriangleAlert } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import {
  hasOwnerPin,
  listOwnerPinDevices,
  listTabletProfiles,
  removeOwnerPinDevice,
  removeOwnerPinOnThisDevice,
  setupOwnerPin,
  switchTablet,
  type OwnerPinDevice,
  type TabletProfileOption,
} from '@/lib/auth';
import { pos, tabletStore } from '@/lib/pos';
import { deviceId, readActivation } from '@/pos';
import { formatDate } from '@/domain/payroll';
import { businessDate, hhmm } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { OwnerPinSetup } from '../pin/OwnerPin';
import { PrinterSection } from './PrinterSection';

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
      <PrinterSection />
      <OwnerPinSection />
    </OwnerLayout>
  );
}

const when = (at: string) => `${hhmm(at)} ${formatDate(businessDate(at))}`;

/** Mã PIN chế độ chủ: mỗi máy một mã. Đổi / bỏ mã của máy này, xóa mã của máy khác (mất máy, không dùng nữa). */
function OwnerPinSection() {
  const owner = useOwner();
  const [hasPin, setHasPin] = useState(hasOwnerPin);
  const [devices, setDevices] = useState<OwnerPinDevice[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const myDevice = deviceId();

  const reload = useCallback(() => {
    listOwnerPinDevices(owner.client)
      .then(setDevices)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [owner.client]);
  useEffect(reload, [reload]);

  async function run(job: () => Promise<void>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await job();
      setHasPin(hasOwnerPin());
      setNotice(done);
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    const activation = readActivation();
    return (
      <div className="fixed inset-0 z-20 overflow-y-auto bg-canvas">
        <OwnerPinSetup
          tabletName={owner.tabletName}
          title={hasPin ? 'Đổi mã PIN máy này' : 'Cài mã PIN máy này'}
          intro="Mã PIN chỉ dùng được trên máy này. Máy khác có mã riêng."
          laterLabel="Thôi"
          save={async (pin) => {
            if (!activation) throw new Error('Máy chưa kích hoạt');
            await setupOwnerPin(owner.client, activation, pin);
          }}
          onDone={() => {
            setEditing(false);
            setHasPin(true);
            setNotice('Đã lưu mã PIN cho máy này.');
            reload();
          }}
          onLater={() => setEditing(false)}
        />
      </div>
    );
  }

  const others = devices?.filter((d) => d.device_id !== myDevice || !hasPin) ?? [];
  return (
    <section className="mt-4 flex flex-col gap-3" data-testid="owner-pin-section">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <KeyRound aria-hidden className="h-5 w-5" /> Mã PIN chế độ chủ
      </h2>
      <div className="card flex flex-col gap-3 p-5">
        <p className="text-lg" data-testid="owner-pin-status">
          {hasPin ? 'Máy này vào chế độ chủ bằng mã PIN.' : 'Máy này chưa có mã PIN: vào chế độ chủ phải nhập mật khẩu.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => setEditing(true)} data-testid="owner-pin-edit">
            {hasPin ? 'Đổi mã PIN' : 'Cài mã PIN'}
          </button>
          {hasPin && (
            <button
              type="button"
              className="btn btn-danger-outline flex-1"
              disabled={busy}
              onClick={() => void run(() => removeOwnerPinOnThisDevice(owner.client), 'Đã bỏ mã PIN của máy này.')}
              data-testid="owner-pin-remove"
            >
              Bỏ mã PIN
            </button>
          )}
        </div>
      </div>
      {others.length > 0 && (
        <div className="card flex flex-col divide-y divide-line overflow-hidden" data-testid="owner-pin-devices">
          <p className="px-4 py-3 text-ink-muted">Máy khác đang có mã PIN. Xóa nếu máy bị mất hoặc không dùng nữa.</p>
          {others.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`owner-pin-device-${d.id}`}>
              <div className="flex flex-col">
                <span className="text-lg font-medium">{d.tablet_name ?? 'Máy không rõ quầy'}</span>
                <span className="text-sm text-ink-muted">
                  Cài lúc {when(d.created_at)}
                  {d.last_used_at && ` · dùng lần cuối ${when(d.last_used_at)}`}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-danger-outline"
                disabled={busy}
                onClick={() => void run(() => removeOwnerPinDevice(owner.client, d.id), `Đã xóa mã PIN của ${d.tablet_name ?? 'máy đó'}.`)}
                data-testid={`owner-pin-device-remove-${d.id}`}
              >
                Xóa
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && (
        <p className="text-success-strong" role="status" data-testid="owner-pin-notice">
          {notice}
        </p>
      )}
      <ErrorText testId="owner-pin-error">{error}</ErrorText>
    </section>
  );
}
