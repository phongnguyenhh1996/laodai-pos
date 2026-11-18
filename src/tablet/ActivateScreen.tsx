import type { SupabaseClient } from '@supabase/supabase-js';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Bike, ChevronRight, KeyRound, Mail, MonitorSmartphone, ShoppingBag, Store, UtensilsCrossed } from 'lucide-react';
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

  // Figma Makaryo: tablet = panel cam bên trái + form bên phải; điện thoại = phần cam ở trên, form trong tấm trắng bo góc.
  return (
    <main data-testid="activate-screen" className="flex h-full flex-col bg-brand md:flex-row md:bg-surface">
      <section className="relative flex shrink-0 flex-col gap-3.5 overflow-hidden px-6 pb-8 pt-6 text-white md:w-[44%] md:max-w-[500px] md:gap-5 md:bg-brand md:p-12">
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-20 hidden h-80 w-80 rounded-full bg-brand-strong/50 md:block" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-28 hidden h-72 w-72 rounded-full bg-brand-strong/50 md:block" />
        <div className="relative flex items-center gap-3">
          <span aria-hidden className="icon-tile h-11 w-11 rounded-xl bg-white text-brand-strong md:h-12 md:w-12">
            <Store className="h-6 w-6" />
          </span>
          <span className="text-xl font-bold md:text-[22px]">Lão Đại Quán</span>
        </div>
        <div className="hidden flex-1 md:block" />
        <p className="relative text-[28px] font-bold leading-9 md:text-4xl md:leading-[46px]">
          Bán nhanh, thu đủ,
          <br />
          chốt ca gọn.
        </p>
        <p className="relative hidden max-w-[380px] text-base font-medium leading-6 md:block">Combo + thanh toán đủ tiền chỉ 3 chạm từ hàng đợi.</p>
        <div className="relative hidden gap-2 md:flex">
          {(
            [
              [UtensilsCrossed, 'Tại chỗ'],
              [ShoppingBag, 'Mang về'],
              [Bike, 'Ship'],
            ] as const
          ).map(([Icon, label]) => (
            <span key={label} className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-2 text-sm font-medium">
              <Icon aria-hidden className="h-4 w-4" />
              {label}
            </span>
          ))}
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-t-[28px] bg-surface px-5 pb-8 pt-7 md:items-center md:justify-center md:rounded-none md:p-10">
        <div className="flex w-full flex-col gap-5 md:max-w-[420px]">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-[26px] font-bold md:text-3xl">{step.kind === 'login' ? 'Đăng nhập' : 'Chọn quầy'}</h1>
            <p className="text-[15px] leading-6 text-ink-subtle md:text-base">
              {step.kind === 'login'
                ? 'Chủ đăng nhập một lần trên máy này, sau đó chọn quầy bán hàng.'
                : 'Máy này sẽ bán hàng ở quầy được chọn.'}
            </p>
          </header>

          {step.kind === 'login' ? (
            <form className="flex flex-col gap-5" onSubmit={login} data-testid="activate-login-form">
              <TextField
                label="Email chủ"
                icon={Mail}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="activate-email"
              />
              <TextField
                label="Mật khẩu"
                icon={KeyRound}
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
                  className="flex min-h-[76px] items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left transition-colors duration-fast hover:border-brand hover:bg-brand-soft disabled:opacity-40"
                  disabled={busy}
                  onClick={() => pick(step.owner, p.id)}
                  data-testid={`activate-profile-${p.id}`}
                >
                  <span aria-hidden className="icon-tile h-12 w-12 rounded-xl bg-brand-soft text-brand">
                    <MonitorSmartphone className="h-6 w-6" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lg font-semibold">{p.name}</span>
                  <ChevronRight aria-hidden className="h-6 w-6 shrink-0 text-ink-subtle" />
                </button>
              ))}
              {step.profiles.length === 0 && <p className="text-ink-subtle">Chưa có quầy nào trong Cài đặt.</p>}
              <ErrorText testId="activate-error">{error}</ErrorText>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
