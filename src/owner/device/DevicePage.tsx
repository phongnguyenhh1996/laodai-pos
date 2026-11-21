import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, KeyRound, Store, TriangleAlert } from 'lucide-react';
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
import { useIsTablet } from '@/app/useMediaQuery';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { loadOwnerCatalog } from '../settings/api';
import { IconTile, PageHead, Section, TONE, btn } from '../ui';
import { OwnerPinSetup } from '../pin/OwnerPin';
import { PrinterSection } from './PrinterSection';

/**
 * `/owner/device`: đổi quầy cho máy đang dùng. Dùng luôn phiên chủ tạm (không đăng nhập lại).
 * Ca + đơn của quầy cũ vẫn nằm trên server; máy khác ở quầy cũ không bị ảnh hưởng.
 */
export function DevicePage() {
  const owner = useOwner();
  const navigate = useNavigate();
  const isTablet = useIsTablet();
  const snap = useSyncExternalStore(tabletStore.subscribe, tabletStore.getSnapshot);
  const [profiles, setProfiles] = useState<TabletProfileOption[] | null>(null);
  const [pointNames, setPointNames] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listTabletProfiles(owner.client)
      .then((p) => alive && setProfiles(p))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    // Chỉ để hiện điểm bán dưới tên quầy: lỗi thì bỏ qua.
    loadOwnerCatalog(owner.client)
      .then((c) => {
        if (!alive) return;
        const byId = new Map(c.points.map((p) => [p.id, p.name]));
        setPointNames(
          Object.fromEntries(
            c.profiles.map((p) => [
              p.id,
              p.point_ids
                .map((id) => byId.get(id))
                .filter(Boolean)
                .join(' · '),
            ]),
          ),
        );
      })
      .catch(() => undefined);
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

  const subtitle = 'Chọn quầy khác để chuyển máy sang quầy đó';
  const list = !profiles ? (
    error ? (
      <ErrorText testId="device-error">{error}</ErrorText>
    ) : (
      <Splash />
    )
  ) : (
    <div className="flex flex-col gap-3.5" data-testid="device-profiles">
      {profiles.map((p) => {
        const current = p.id === owner.tabletProfileId;
        const selected = p.id === picked;
        const on = current || selected;
        return (
          <button
            key={p.id}
            type="button"
            disabled={current || busy}
            aria-pressed={selected}
            onClick={() => setPicked(p.id)}
            data-testid={`device-profile-${p.id}`}
            className={`flex min-h-[70px] items-center justify-between gap-3 rounded-[14px] px-[15px] py-3.5 text-left transition-colors duration-fast ${
              current ? 'border-[1.5px] border-brand bg-[#ffeee7]' : selected ? 'border-[1.5px] border-brand bg-white' : 'border border-line bg-white hover:border-line-strong'
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <IconTile
                icon={Store}
                className="h-10 w-10 rounded-xl"
                iconClass="h-5 w-5"
                tone={current ? 'bg-white text-[#c2380a]' : on ? 'bg-[#ffeee7] text-[#c2380a]' : 'bg-[#f8f8f8] text-[#6d6d6d]'}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <b className={`truncate text-[15px] font-bold leading-[19px] ${current ? 'text-[#c2380a]' : ''}`}>{p.name}</b>
                {pointNames[p.id] && <span className="truncate text-xs leading-[15px] text-[#888]">{pointNames[p.id]}</span>}
              </span>
            </span>
            {current ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-2.5 py-1 text-xs font-semibold leading-[15px] text-white">
                <Check aria-hidden className="h-3.5 w-3.5" />
                Đang dùng
              </span>
            ) : (
              <span aria-hidden className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full ${selected ? 'bg-brand' : 'border border-[#cfcfcf] bg-white'}`}>
                {selected && <span className="h-2 w-2 rounded-full bg-white" />}
              </span>
            )}
          </button>
        );
      })}
      {profiles.length <= 1 && <p className="text-[13px] leading-[19px] text-[#888]">Chưa có quầy nào khác. Thêm quầy trong Cài đặt → Quầy.</p>}
      {target && (
        <Section title={`Chuyển sang ${target.name}?`} subtitle="Sau khi chuyển, máy về màn bán hàng của quầy mới." testId="device-confirm">
          {openShift && (
            <p className="flex items-start gap-2.5 rounded-xl bg-[#fef5e1] px-3.5 py-3 text-[13px] leading-[19px] text-[#a16207]" data-testid="device-open-shift">
              <TriangleAlert aria-hidden className="mt-px h-[18px] w-[18px] shrink-0" />
              <span>
                {owner.tabletName} đang có ca của {openShift.staff_name}. Ca và đơn vẫn giữ nguyên trên server: máy khác ở quầy này bán tiếp được, hoặc chuyển máy này về lại quầy này để đóng ca.
              </span>
            </p>
          )}
          <ErrorText testId="device-error">{error}</ErrorText>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" className={btn('outline')} disabled={busy} onClick={() => setPicked(null)} data-testid="device-cancel">
              Thôi
            </button>
            <button type="button" className={btn('brand')} disabled={busy} onClick={() => void confirm()} data-testid="device-switch">
              {busy ? 'Đang chuyển…' : 'Chuyển máy'}
            </button>
          </div>
        </Section>
      )}
    </div>
  );

  return (
    <OwnerLayout title="Quầy của máy này" subtitle={isTablet ? subtitle : undefined} back={isTablet ? '/owner' : '/owner/more'} tabBar wide testId="owner-device-page">
      {isTablet ? (
        <div className="grid grid-cols-2 items-start gap-5">
          {list}
          <div className="flex flex-col gap-4">
            <PrinterSection />
            <OwnerPinSection />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <PageHead title="Máy này bán ở quầy nào?" subtitle={subtitle} />
          {list}
          <PrinterSection />
          <OwnerPinSection />
        </div>
      )}
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
    <Section
      title="Mã PIN chế độ chủ"
      subtitle={<span data-testid="owner-pin-status">{hasPin ? 'Máy này vào chế độ chủ bằng mã PIN.' : 'Máy này chưa có mã PIN: vào chế độ chủ phải nhập mật khẩu.'}</span>}
      right={<IconTile icon={KeyRound} className="h-[34px] w-[34px] rounded-[10px]" tone={TONE.orange} />}
      testId="owner-pin-section"
    >
      <div className="flex gap-2.5">
        <button type="button" className={btn('soft', 'min-h-[45px] flex-1 text-[15px]')} disabled={busy} onClick={() => setEditing(true)} data-testid="owner-pin-edit">
          <KeyRound aria-hidden className="h-[17px] w-[17px]" />
          {hasPin ? 'Đổi mã PIN' : 'Cài mã PIN'}
        </button>
        {hasPin && (
          <button
            type="button"
            className={btn('outline', 'min-h-[45px] flex-1 text-[15px] text-[#b42318]')}
            disabled={busy}
            onClick={() => void run(() => removeOwnerPinOnThisDevice(owner.client), 'Đã bỏ mã PIN của máy này.')}
            data-testid="owner-pin-remove"
          >
            Bỏ mã PIN
          </button>
        )}
      </div>
      {others.length > 0 && (
        <div className="flex flex-col border-t border-line pt-3" data-testid="owner-pin-devices">
          <p className="pb-1 text-xs leading-[17px] text-[#888]">Máy khác đang có mã PIN. Xóa nếu máy bị mất hoặc không dùng nữa.</p>
          {others.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0" data-testid={`owner-pin-device-${d.id}`}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <b className="truncate text-sm font-semibold leading-[18px]">{d.tablet_name ?? 'Máy không rõ quầy'}</b>
                <span className="text-xs leading-[15px] text-[#888]">
                  Cài lúc {when(d.created_at)}
                  {d.last_used_at && ` · dùng lần cuối ${when(d.last_used_at)}`}
                </span>
              </div>
              <button
                type="button"
                className={btn('outline', 'min-h-9 shrink-0 px-3 text-[13px] text-[#b42318]')}
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
        <p className="text-[13px] font-medium text-[#15803d]" role="status" data-testid="owner-pin-notice">
          {notice}
        </p>
      )}
      <ErrorText testId="owner-pin-error">{error}</ErrorText>
    </Section>
  );
}
