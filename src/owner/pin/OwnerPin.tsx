import { useCallback, useEffect, useState } from 'react';
import { Delete, KeyRound } from 'lucide-react';
import { ErrorText, errorMessage } from '@/app/ui';

/** Mã PIN chế độ chủ: 6 chữ số (server cũng kiểm). */
export const PIN_LENGTH = 6;

/**
 * Bàn phím số + 6 chấm. Đủ 6 số ⇒ gọi `onComplete` và xóa trắng (nhập lại khi sai).
 * Bấm phím số / Backspace trên bàn phím thật cũng được.
 */
export function PinPad({
  onComplete,
  disabled,
  testId = 'pin-pad',
}: {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const [pin, setPin] = useState('');

  const press = useCallback(
    (d: string) => !disabled && setPin((p) => (p.length >= PIN_LENGTH ? p : p + d)),
    [disabled],
  );

  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;
    setPin('');
    onComplete(pin);
  }, [pin, onComplete]);
  const back = useCallback(() => !disabled && setPin((p) => p.slice(0, -1)), [disabled]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        back();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  return (
    <div className="flex flex-col items-center gap-6" data-testid={testId}>
      <div className="flex gap-3" aria-label={`Đã nhập ${pin.length} trên ${PIN_LENGTH} số`} data-testid={`${testId}-dots`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={`h-4 w-4 rounded-full border-2 transition-colors duration-fast ${
              i < pin.length ? 'border-ink bg-ink' : 'border-line-strong bg-surface'
            }`}
          />
        ))}
      </div>
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <PinKey key={d} label={d} onPress={() => press(d)} disabled={disabled} testId={`${testId}-${d}`} />
        ))}
        <span />
        <PinKey label="0" onPress={() => press('0')} disabled={disabled} testId={`${testId}-0`} />
        <button
          type="button"
          className="btn btn-segment h-16 text-ink-muted"
          onClick={back}
          disabled={disabled || pin.length === 0}
          aria-label="Xóa số vừa nhập"
          data-testid={`${testId}-back`}
        >
          <Delete aria-hidden className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}

function PinKey({ label, onPress, disabled, testId }: { label: string; onPress: () => void; disabled?: boolean; testId: string }) {
  return (
    <button type="button" className="btn btn-secondary h-16 text-2xl tabular-nums" onClick={onPress} disabled={disabled} data-testid={testId}>
      {label}
    </button>
  );
}

/**
 * Cài / đổi mã PIN cho máy này: nhập 6 số, nhập lại để xác nhận, rồi lưu (`save`).
 * Chỉ máy này dùng được mã này; mỗi máy có mã riêng.
 */
export function OwnerPinSetup({
  title = 'Cài mã PIN cho máy này?',
  intro = 'Lần sau vào chế độ chủ trên máy này chỉ cần nhập mã PIN 6 số thay cho mật khẩu. Mỗi máy có mã riêng.',
  save,
  onDone,
  onLater,
  laterLabel = 'Để sau',
  onDecline,
}: {
  title?: string;
  intro?: string;
  save: (pin: string) => Promise<void>;
  onDone: () => void;
  onLater: () => void;
  laterLabel?: string;
  onDecline?: () => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onComplete = useCallback(
    async (pin: string) => {
      if (first === null) {
        setFirst(pin);
        setError(null);
        return;
      }
      if (pin !== first) {
        setFirst(null);
        setError('Hai lần nhập không khớp. Nhập lại mã PIN mới.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await save(pin);
        onDone();
      } catch (e) {
        setError(errorMessage(e));
        setFirst(null);
        setBusy(false);
      }
    },
    [first, save, onDone],
  );

  return (
    <main data-testid="owner-pin-setup" className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-3">
        <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-white shadow-card">
          <KeyRound className="h-7 w-7" />
        </span>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-lg text-ink-muted">{intro}</p>
      </header>
      <section className="card flex flex-col gap-5 p-6">
        <p className="text-center text-lg font-semibold" data-testid="owner-pin-setup-step">
          {busy ? 'Đang lưu…' : first === null ? 'Nhập mã PIN mới (6 số)' : 'Nhập lại mã PIN để xác nhận'}
        </p>
        {/* key: đổi bước ⇒ bàn phím mới, chấm trống */}
        <PinPad key={first === null ? 'new' : 'confirm'} onComplete={(p) => void onComplete(p)} disabled={busy} testId="owner-pin-new" />
        <ErrorText testId="owner-pin-setup-error">{error}</ErrorText>
        <div className="flex flex-col gap-2">
          <button type="button" className="btn btn-secondary" onClick={onLater} disabled={busy} data-testid="owner-pin-later">
            {laterLabel}
          </button>
          {onDecline && (
            <button type="button" className="btn btn-segment text-base" onClick={onDecline} disabled={busy} data-testid="owner-pin-decline">
              Không dùng PIN trên máy này
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
