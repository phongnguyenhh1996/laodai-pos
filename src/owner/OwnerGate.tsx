import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { useActivation } from '@/app/useActivation';
import { useIdleTimeout } from '@/app/useIdleTimeout';
import { enterOwnerModeOnTablet, exitOwnerMode } from '@/lib/auth';
import type { Activation } from '@/pos';
import { OwnerContext, type OwnerSession } from './OwnerContext';
import { OwnerHome } from './OwnerHome';
import { SettingsRoutes } from './settings/SettingsPages';
import { ShiftRoutes } from './shifts/ShiftPages';
import { DebtRoutes } from './debts/DebtPages';
import { LogPage } from './log/LogPages';
import { OrderRoutes } from './orders/OrderPages';
import { ReportPage } from './reports/ReportPage';

/** Chế độ chủ tự thoát sau 2 phút không thao tác (mục 1.2). */
export const OWNER_IDLE_MS = 2 * 60_000;

function OwnerRoutes() {
  return (
    <Routes>
      <Route path="settings/*" element={<SettingsRoutes />} />
      <Route path="shifts/*" element={<ShiftRoutes />} />
      <Route path="debts/*" element={<DebtRoutes />} />
      <Route path="log" element={<LogPage />} />
      <Route path="orders/*" element={<OrderRoutes />} />
      <Route path="reports" element={<ReportPage />} />
      <Route path="*" element={<OwnerHome />} />
    </Routes>
  );
}

/**
 * `/owner/*`: mọi thiết bị như nhau. Máy chưa đăng nhập + chọn quầy ⇒ về màn đăng nhập;
 * đã chọn quầy ⇒ nhập lại mật khẩu chủ (phiên chủ tạm trong bộ nhớ, tự thoát sau 2 phút).
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

  // Rời chế độ chủ bằng bất kỳ đường nào (nút Thoát, hết giờ, nút Back) ⇒ thu hồi phiên tạm.
  useEffect(() => (owner ? () => exitOwnerMode(owner) : undefined), [owner]);

  const session = useMemo<OwnerSession | null>(
    () =>
      owner && {
        client: owner,
        email: activation.owner_email,
        tabletName: activation.tablet_name,
        leave: () => navigate('/', { replace: true }),
      },
    [owner, activation, navigate],
  );

  useIdleTimeout(OWNER_IDLE_MS, () => navigate('/', { replace: true }), owner !== null);

  if (!session) return <OwnerUnlock activation={activation} onUnlocked={setOwner} onCancel={() => navigate('/')} />;
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
  onUnlocked: (c: SupabaseClient) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await enterOwnerModeOnTablet(activation, password));
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <main data-testid="owner-unlock" className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-3">
        <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-white shadow-card">
          <LockKeyhole className="h-7 w-7" />
        </span>
        <h1 className="text-3xl font-bold">Chế độ chủ</h1>
        <p className="text-lg text-ink-muted">Nhập mật khẩu chủ. Mỗi lần vào đều được báo cho chủ.</p>
      </header>
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
      </form>
    </main>
  );
}
