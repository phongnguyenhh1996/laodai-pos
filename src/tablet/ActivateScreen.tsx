import type { SupabaseClient } from '@supabase/supabase-js';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ChevronRight, Store } from 'lucide-react';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { useActivation } from '@/app/useActivation';
import { activateTablet, listTabletProfiles, signInOwnerEphemeral, type TabletProfileOption } from '@/lib/auth';

type Step = { kind: 'login' } | { kind: 'pick'; owner: SupabaseClient; profiles: TabletProfileOption[] };

/**
 * Màn vào app, giống nhau trên mọi thiết bị: chủ đăng nhập một lần → chọn quầy (hồ sơ tablet).
 * Phiên chủ chỉ nằm trong bộ nhớ và bị hủy ngay sau khi chọn quầy; máy giữ phiên quầy.
 */
export function ActivateScreen() {
  const act = useActivation();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: 'login' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (act.status === 'loading') return <Splash />;
  if (act.status === 'active') return <Navigate to="/" replace />;

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const owner = await signInOwnerEphemeral(email, password);
      const profiles = await listTabletProfiles(owner);
      setPassword('');
      setStep({ kind: 'pick', owner, profiles });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function pick(owner: SupabaseClient, profileId: string) {
    setBusy(true);
    setError(null);
    try {
      await activateTablet(owner, profileId);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main data-testid="activate-screen" className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-3">
        <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-strong text-white shadow-card">
          <Store className="h-7 w-7" />
        </span>
        <h1 className="text-3xl font-bold">{step.kind === 'login' ? 'Đăng nhập' : 'Chọn quầy'}</h1>
        <p className="text-lg text-ink-muted">
          {step.kind === 'login'
            ? 'Chủ đăng nhập một lần trên máy này, sau đó chọn quầy bán hàng.'
            : 'Máy này sẽ bán hàng ở quầy được chọn.'}
        </p>
      </header>

      {step.kind === 'login' ? (
        <form className="card flex flex-col gap-4 p-6" onSubmit={login} data-testid="activate-login-form">
          <TextField
            label="Email chủ"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="activate-email"
          />
          <TextField
            label="Mật khẩu"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="activate-password"
          />
          <ErrorText testId="activate-error">{error}</ErrorText>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="activate-login">
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-3" data-testid="activate-profiles">
          {step.profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn btn-secondary min-h-[72px] justify-between text-left text-xl"
              disabled={busy}
              onClick={() => pick(step.owner, p.id)}
              data-testid={`activate-profile-${p.id}`}
            >
              {p.name}
              <ChevronRight aria-hidden className="h-6 w-6 text-ink-subtle" />
            </button>
          ))}
          {step.profiles.length === 0 && <p className="text-ink-subtle">Chưa có quầy nào trong Cài đặt.</p>}
          <ErrorText testId="activate-error">{error}</ErrorText>
        </div>
      )}
    </main>
  );
}
