import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { useActivation } from '@/app/useActivation';
import { useIdleTimeout } from '@/app/useIdleTimeout';
import { enterOwnerModeOnTablet, exitOwnerMode, signInOwner } from '@/lib/auth';
import { decodeClaims, supabase } from '@/lib/supabase';
import type { Activation } from '@/sync/db';
import { OwnerContext, type OwnerSession } from './OwnerContext';
import { OwnerHome } from './OwnerHome';
import { SettingsRoutes } from './settings/SettingsPages';

/** Chế độ chủ trên tablet tự thoát sau 2 phút không thao tác (mục 1.2). */
export const OWNER_IDLE_MS = 2 * 60_000;

function OwnerRoutes() {
  return (
    <Routes>
      <Route path="settings/*" element={<SettingsRoutes />} />
      <Route path="*" element={<OwnerHome />} />
    </Routes>
  );
}

/**
 * `/owner/*`: trên tablet đã kích hoạt ⇒ nhập lại mật khẩu chủ (phiên tạm);
 * trên thiết bị khác (điện thoại chủ) ⇒ đăng nhập email + mật khẩu, phiên lưu trên máy.
 */
export function OwnerGate() {
  const act = useActivation();
  if (act.status === 'loading') return <Splash />;
  if (act.status === 'active') return <TabletOwnerMode activation={act.activation} />;
  return <PhoneOwner />;
}

// ---------------------------------------------------------------- tablet

function TabletOwnerMode({ activation }: { activation: Activation }) {
  const navigate = useNavigate();
  const [owner, setOwner] = useState<SupabaseClient | null>(null);

  // Rời chế độ chủ bằng bất kỳ đường nào (nút Thoát, hết giờ, nút Back) ⇒ thu hồi phiên tạm.
  useEffect(() => (owner ? () => exitOwnerMode(owner) : undefined), [owner]);

  const session = useMemo<OwnerSession | null>(
    () =>
      owner && {
        client: owner,
        email: activation.owner_email,
        device: 'tablet',
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
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Chế độ chủ</h1>
        <p className="text-lg text-stone-600">Nhập mật khẩu chủ. Mỗi lần vào đều được báo cho chủ.</p>
      </header>
      <form className="flex flex-col gap-4" onSubmit={submit}>
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
          <button type="button" className="btn flex-1 border border-stone-300 bg-white" onClick={onCancel} data-testid="owner-cancel">
            Quay lại bán hàng
          </button>
          <button type="submit" className="btn flex-1 bg-amber-700 text-white" disabled={busy} data-testid="owner-unlock-submit">
            {busy ? 'Đang kiểm tra…' : 'Vào'}
          </button>
        </div>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------- điện thoại chủ

type PhoneState = { kind: 'loading' } | { kind: 'out' } | { kind: 'in'; email: string };

function ownerEmailOf(accessToken: string | undefined): string | null {
  const c = accessToken ? decodeClaims(accessToken) : null;
  return c?.role === 'owner' ? (c.email ?? '') : null;
}

function PhoneOwner() {
  const [state, setState] = useState<PhoneState>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    const apply = (token: string | undefined) => {
      if (!alive) return;
      const email = ownerEmailOf(token);
      setState(email === null ? { kind: 'out' } : { kind: 'in', email });
    };
    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session?.access_token))
      .catch(() => apply(undefined));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => apply(s?.access_token));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const session = useMemo<OwnerSession | null>(
    () =>
      state.kind === 'in'
        ? {
            client: supabase,
            email: state.email,
            device: 'phone',
            leave: () => void supabase.auth.signOut({ scope: 'local' }).catch(() => undefined),
          }
        : null,
    [state],
  );

  if (state.kind === 'loading') return <Splash />;
  if (!session) return <OwnerLogin />;
  return (
    <OwnerContext.Provider value={session}>
      <OwnerRoutes />
    </OwnerContext.Provider>
  );
}

function OwnerLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Thành công ⇒ onAuthStateChange chuyển sang màn chủ.
      await signInOwner(supabase, email, password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main data-testid="owner-login" className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold">Đăng nhập chủ</h1>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="owner-email"
        />
        <TextField
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="owner-password"
        />
        <ErrorText testId="owner-error">{error}</ErrorText>
        <button type="submit" className="btn bg-amber-700 text-white" disabled={busy} data-testid="owner-login-submit">
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </main>
  );
}
