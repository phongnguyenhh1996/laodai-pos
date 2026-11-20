import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { useActivation, useTabletName } from '@/app/useActivation';
import { useIdleTimeout } from '@/app/useIdleTimeout';
import { AuthError, enterOwnerModeOnTablet, enterOwnerModeWithPin, exitOwnerMode, hasOwnerPin, setupOwnerPin } from '@/lib/auth';
import { startPrinting } from '@/lib/print';
import { declineOwnerPin, ownerPinDeclined, type Activation } from '@/pos';
import { OwnerPinSetup, PinPad } from './pin/OwnerPin';
import { OwnerContext, type OwnerSession } from './OwnerContext';
import { OwnerHome } from './OwnerHome';
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
  onUnlocked,
  onCancel,
}: {
  activation: Activation;
  onUnlocked: (c: SupabaseClient, via: 'pin' | 'password') => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'pin' | 'password'>(() => (hasOwnerPin() ? 'pin' : 'password'));
  const [password, setPassword] = useState('');
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

  const header = (
    <header className="flex flex-col gap-3">
      <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-white shadow-card">
        <LockKeyhole className="h-7 w-7" />
      </span>
      <h1 className="text-3xl font-bold">Chế độ chủ</h1>
      <p className="text-lg text-ink-muted">
        {mode === 'pin' ? 'Nhập mã PIN chế độ chủ của máy này.' : 'Nhập mật khẩu chủ. Lần đầu vào trên máy này sẽ được báo cho chủ.'}
      </p>
    </header>
  );

  if (mode === 'pin') {
    return (
      <main data-testid="owner-unlock" className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
        {header}
        <section className="card flex flex-col gap-5 p-6">
          <PinPad onComplete={(p) => void submitPin(p)} disabled={busy} busyLabel="Đang kiểm tra…" testId="owner-pin" />
          <ErrorText testId="owner-error">{error}</ErrorText>
          <div className="flex gap-3">
            <button type="button" className="btn btn-secondary flex-1" onClick={onCancel} data-testid="owner-cancel">
              Quay lại bán hàng
            </button>
            <button
              type="button"
              className="btn btn-segment flex-1"
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
        </section>
      </main>
    );
  }

  return (
    <main data-testid="owner-unlock" className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      {header}
      <form className="card flex flex-col gap-4 p-6" onSubmit={submit}>
        <TextField
          label="Mật khẩu chủ"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="owner-password"
        />
        <ErrorText testId="owner-error">{error}</ErrorText>
        <div className="flex gap-3">
          <button type="button" className="btn btn-secondary flex-1" onClick={onCancel} data-testid="owner-cancel">
            Quay lại bán hàng
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy} data-testid="owner-unlock-submit">
            {busy ? 'Đang kiểm tra…' : 'Vào'}
          </button>
        </div>
        {hasOwnerPin() && (
          <button
            type="button"
            className="btn btn-segment"
            onClick={() => {
              setMode('pin');
              setError(null);
            }}
            data-testid="owner-use-pin"
          >
            Dùng mã PIN
          </button>
        )}
      </form>
    </main>
  );
}
