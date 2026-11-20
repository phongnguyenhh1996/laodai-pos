import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { ChevronLeft, LockKeyhole, LogOut } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useActivation, useTabletName } from '@/app/useActivation';
import { useIdleTimeout } from '@/app/useIdleTimeout';
import { AuthError, enterOwnerModeOnTablet, enterOwnerModeWithPin, exitOwnerMode, hasOwnerPin, setupOwnerPin } from '@/lib/auth';
import { startPrinting } from '@/lib/print';
import { declineOwnerPin, ownerPinDeclined, type Activation } from '@/pos';
import { OwnerPinSetup, PinHeader, PinPad } from './pin/OwnerPin';
import { IdleNote, OwnerAuthShell, authBtnPrimary, authBtnSecondary, authLink } from './OwnerAuthShell';
import { OwnerContext, type OwnerSession } from './OwnerContext';
import { OwnerHome } from './OwnerHome';
import { OwnerMore } from './OwnerMore';
import { SettingsRoutes } from './settings/SettingsPages';
import { ShiftRoutes } from './shifts/ShiftPages';
import { DebtRoutes } from './debts/DebtPages';
import { PayrollRoutes } from './payroll/PayrollPages';
import { LogPage } from './log/LogPages';
import { OrderRoutes } from './orders/OrderPages';
import { ReportPage } from './reports/ReportPage';
import { DevicePage } from './device/DevicePage';

/** Chế độ chủ tự thoát sau 2 phút không thao tác (mục 1.2). */
export const OWNER_IDLE_MS = 2 * 60_000;

function OwnerRoutes() {
  return (
    <Routes>
      <Route path="settings/*" element={<SettingsRoutes />} />
      <Route path="shifts/*" element={<ShiftRoutes />} />
      <Route path="debts/*" element={<DebtRoutes />} />
      <Route path="payroll/*" element={<PayrollRoutes />} />
      <Route path="log" element={<LogPage />} />
      <Route path="orders/*" element={<OrderRoutes />} />
      <Route path="reports" element={<ReportPage />} />
      <Route path="device" element={<DevicePage />} />
      <Route path="more" element={<OwnerMore />} />
      <Route path="*" element={<OwnerHome />} />
    </Routes>
  );
}

/**
 * `/owner/*`: mọi thiết bị như nhau. Máy chưa đăng nhập + chọn quầy ⇒ về màn đăng nhập;
 * đã chọn quầy ⇒ nhập mã PIN của máy (nếu đã cài) hoặc mật khẩu chủ (phiên chủ tạm trong bộ nhớ, tự thoát sau 2 phút).
 * Vào bằng mật khẩu trên máy chưa có PIN ⇒ hỏi cài PIN (PIN theo từng máy).
 */
export function OwnerGate() {
  const act = useActivation();
  if (act.status === 'loading') return <Splash />;
  if (act.status === 'none') return <Navigate to="/activate" replace />;
  return <OwnerMode activation={act.activation} />;
}

function OwnerMode({ activation }: { activation: Activation }) {
  const navigate = useNavigate();
  const [owner, setOwner] = useState<SupabaseClient | null>(null);
  // Vừa vào bằng mật khẩu trên máy chưa có PIN ⇒ hỏi cài PIN trước khi vào.
  const [askPin, setAskPin] = useState(false);
  const tabletName = useTabletName(activation);

  // Tablet có máy in vẫn nhận lệnh in từ xa khi đang ở chế độ chủ (kể cả khi mở thẳng / tải lại trang chủ).
  useEffect(() => startPrinting(activation.tablet_profile_id), [activation.tablet_profile_id]);

  // Rời chế độ chủ bằng bất kỳ đường nào (nút Thoát, hết giờ, nút Back) ⇒ thu hồi phiên tạm.
  useEffect(() => (owner ? () => exitOwnerMode(owner) : undefined), [owner]);

  const session = useMemo<OwnerSession | null>(
    () =>
      owner && {
        client: owner,
        email: activation.owner_email,
        tabletProfileId: activation.tablet_profile_id,
        tabletName,
        leave: () => navigate('/', { replace: true }),
      },
    [owner, activation, tabletName, navigate],
  );

  useIdleTimeout(OWNER_IDLE_MS, () => navigate('/', { replace: true }), owner !== null);

  if (!session) {
    return (
      <OwnerUnlock
        activation={activation}
        tabletName={tabletName}
        onUnlocked={(c, via) => {
          setAskPin(via === 'password' && !hasOwnerPin() && !ownerPinDeclined());
          setOwner(c);
        }}
        onCancel={() => navigate('/')}
      />
    );
  }
  if (askPin) {
    return (
      <OwnerPinSetup
        tabletName={tabletName}
        save={(pin) => setupOwnerPin(session.client, activation, pin)}
        onDone={() => setAskPin(false)}
        onLater={() => setAskPin(false)}
        onDecline={() => {
          declineOwnerPin();
          setAskPin(false);
        }}
      />
    );
  }
  return (
    <OwnerContext.Provider value={session}>
      <OwnerRoutes />
    </OwnerContext.Provider>
  );
}

function OwnerUnlock({
  activation,
  tabletName,
  onUnlocked,
  onCancel,
}: {
  activation: Activation;
  tabletName: string;
  onUnlocked: (c: SupabaseClient, via: 'pin' | 'password') => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'pin' | 'password'>(() => (hasOwnerPin() ? 'pin' : 'password'));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await enterOwnerModeOnTablet(activation, password), 'password');
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      setBusy(false);
    }
  }

  async function submitPin(pin: string) {
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await enterOwnerModeWithPin(activation, pin), 'pin');
    } catch (err) {
      if (err instanceof AuthError && err.code === 'wrong_pin') {
        setError(err.remaining ? `Sai mã PIN. Còn ${err.remaining} lần thử, sai hết thì phải nhập mật khẩu.` : err.message);
      } else {
        // PIN bị xóa (sai quá nhiều / chủ xóa) ⇒ chuyển sang mật khẩu.
        if (err instanceof AuthError && (err.code === 'pin_locked' || err.code === 'pin_missing')) setMode('password');
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  }

  const back = (
    <button type="button" className={authBtnSecondary} onClick={onCancel} data-testid="owner-cancel">
      <ChevronLeft aria-hidden className="h-[17px] w-[17px]" />
      Quay lại bán hàng
    </button>
  );

  // Máy đã cài PIN: cùng bố cục với màn cài PIN (Figma R11b / T19b).
  if (mode === 'pin') {
    return (
      <OwnerAuthShell tabletName={tabletName} testId="owner-unlock">
        <div className="flex w-full flex-col gap-[22px] md:max-w-[400px]">
          <PinHeader icon={LockKeyhole} title="Nhập mã PIN" intro="Nhập mã PIN chế độ chủ của máy này." />
          <PinPad onComplete={(p) => void submitPin(p)} disabled={busy} busyLabel="Đang kiểm tra…" testId="owner-pin" />
          <ErrorText testId="owner-error">{error}</ErrorText>
          <div className="flex flex-col gap-2.5">
            {back}
            <button
              type="button"
              className={authLink}
              disabled={busy}
              onClick={() => {
                setMode('password');
                setError(null);
              }}
              data-testid="owner-use-password"
            >
              Dùng mật khẩu
            </button>
          </div>
        </div>
      </OwnerAuthShell>
    );
  }

  // Figma R11 (điện thoại) / T19 (tablet).
  return (
    <OwnerAuthShell tabletName={tabletName} mobileHeader testId="owner-unlock">
      <form
        className="flex w-full flex-col gap-4 rounded-3xl bg-white px-5 py-6 shadow-[0_4px_16px_rgb(0_0_0/0.06)] md:max-w-[420px] md:shadow-[0_8px_32px_rgb(0_0_0/0.06)]"
        onSubmit={submit}
      >
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-bold leading-[25px] tracking-normal">Đăng nhập</h2>
          <p className="text-[13px] leading-[19px] text-[#888]">Nhập mật khẩu chủ. Lần đầu vào trên máy này sẽ được báo cho chủ.</p>
        </header>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium leading-4 text-[#6d6d6d]">Mật khẩu chủ</span>
          <span className="flex min-h-[45px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 transition-[border-color,box-shadow] duration-fast focus-within:border-brand focus-within:ring-1 focus-within:ring-inset focus-within:ring-brand">
            <LockKeyhole aria-hidden className="h-4 w-4 shrink-0 text-[#888]" />
            <input
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] leading-[19px] font-medium text-[#111] outline-none placeholder:font-normal placeholder:text-[#888]"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="owner-password"
            />
            <button
              type="button"
              className="-mr-1 shrink-0 rounded-md px-1 py-1 text-[13px] text-[#888] hover:text-[#6d6d6d]"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              data-testid="owner-password-toggle"
            >
              {showPassword ? 'Ẩn' : 'Hiện'}
            </button>
          </span>
        </label>
        <ErrorText testId="owner-error">{error}</ErrorText>
        <button type="submit" className={authBtnPrimary} disabled={busy} data-testid="owner-unlock-submit">
          <LogOut aria-hidden className="h-[17px] w-[17px]" />
          {busy ? 'Đang kiểm tra…' : 'Vào chế độ chủ'}
        </button>
        {back}
        {hasOwnerPin() && (
          <button
            type="button"
            className={authLink}
            onClick={() => {
              setMode('pin');
              setError(null);
            }}
            data-testid="owner-use-pin"
          >
            Dùng mã PIN
          </button>
        )}
        <IdleNote />
      </form>
    </OwnerAuthShell>
  );
}
