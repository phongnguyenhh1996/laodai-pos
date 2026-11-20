import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Delete, KeyRound, type LucideIcon } from 'lucide-react';
import { ErrorText, errorMessage } from '@/app/ui';
import { OwnerAuthShell, authBtnSecondary, authLink } from '../OwnerAuthShell';

/** Mã PIN chế độ chủ: 6 chữ số (server cũng kiểm). */
export const PIN_LENGTH = 6;

/**
 * Bàn phím số + 6 chấm. Đủ 6 số ⇒ gọi `onComplete`, chấm vẫn đầy trong lúc xử lý.
 * Người gọi phải `disabled` trong lúc xử lý (hết `disabled` ⇒ xóa trắng để nhập lại),
 * hoặc đổi `key` để có bàn phím mới. `busyLabel` hiện dưới chấm khi đang xử lý.
 * Bấm phím số / Backspace trên bàn phím thật cũng được.
 */
export function PinPad({
  onComplete,
  disabled,
  busyLabel,
  label,
  labelTestId,
  testId = 'pin-pad',
}: {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  busyLabel?: string;
  /** Dòng nhắc trên hàng chấm (vd. "Nhập mã PIN mới (6 số)"). */
  label?: string;
  labelTestId?: string;
  testId?: string;
}) {
  const [pin, setPin] = useState('');
  const [sent, setSent] = useState(false);

  const press = useCallback(
    (d: string) => !disabled && !sent && setPin((p) => (p.length >= PIN_LENGTH ? p : p + d)),
    [disabled, sent],
  );

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || sent) return;
    setSent(true);
    onComplete(pin);
  }, [pin, sent, onComplete]);

  // Xử lý xong mà bàn phím còn đây (vd. sai PIN) ⇒ xóa trắng để nhập lại.
  useEffect(() => {
    if (sent && !disabled) {
      setPin('');
      setSent(false);
    }
  }, [sent, disabled]);
  const busy = sent && disabled;
  const back = useCallback(() => !disabled && !sent && setPin((p) => p.slice(0, -1)), [disabled, sent]);

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
    <div className="flex w-full flex-col items-center gap-[22px]" data-testid={testId} aria-busy={busy || undefined}>
      <div className="flex flex-col items-center gap-3">
        {label && (
          <p className="text-center text-[13px] font-semibold leading-4 text-[#6d6d6d]" data-testid={labelTestId}>
            {label}
          </p>
        )}
        <div className={`flex gap-3 ${busy ? 'animate-pulse' : ''}`} aria-label={`Đã nhập ${pin.length} trên ${PIN_LENGTH} số`} data-testid={`${testId}-dots`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-3.5 w-3.5 rounded-full transition-colors duration-fast ${i < pin.length ? 'bg-brand' : 'bg-[#e3e3e3]'}`}
            />
          ))}
        </div>
        {busy && busyLabel && (
          <p role="status" className="text-center text-[13px] text-[#888]" data-testid={`${testId}-busy`}>
            {busyLabel}
          </p>
        )}
      </div>
      <div className="grid w-full grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <PinKey key={d} onClick={() => press(d)} disabled={disabled} testId={`${testId}-${d}`}>
            {d}
          </PinKey>
        ))}
        <span />
        <PinKey onClick={() => press('0')} disabled={disabled} testId={`${testId}-0`}>
          0
        </PinKey>
        <PinKey onClick={back} disabled={disabled || pin.length === 0} testId={`${testId}-back`} label="Xóa số vừa nhập">
          <Delete aria-hidden className="h-[22px] w-[22px]" />
        </PinKey>
      </div>
    </div>
  );
}

function PinKey({
  children,
  onClick,
  disabled,
  testId,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="flex h-[58px] select-none items-center justify-center rounded-[14px] border border-line bg-white text-[22px] font-semibold tabular-nums text-[#111] transition-colors duration-fast hover:bg-surface-muted active:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
    >
      {children}
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
  tabletName,
}: {
  title?: string;
  intro?: string;
  save: (pin: string) => Promise<void>;
  onDone: () => void;
  onLater: () => void;
  laterLabel?: string;
  onDecline?: () => void;
  /** Tên quầy của máy này (hiện ở nửa trái trên tablet). */
  tabletName: string;
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
    <OwnerAuthShell tabletName={tabletName} testId="owner-pin-setup">
      <div className="flex w-full flex-col gap-[22px] md:max-w-[400px]">
        <PinHeader icon={KeyRound} title={title} intro={intro} />
        {/* key: đổi bước ⇒ bàn phím mới, chấm trống */}
        <PinPad
          key={first === null ? 'new' : 'confirm'}
          onComplete={(p) => void onComplete(p)}
          disabled={busy}
          busyLabel="Đang lưu mã PIN…"
          label={first === null ? 'Nhập mã PIN mới (6 số)' : 'Nhập lại mã PIN để xác nhận'}
          labelTestId="owner-pin-setup-step"
          testId="owner-pin-new"
        />
        <ErrorText testId="owner-pin-setup-error">{error}</ErrorText>
        <div className="flex flex-col gap-2.5">
          <button type="button" className={authBtnSecondary} onClick={onLater} disabled={busy} data-testid="owner-pin-later">
            {laterLabel}
          </button>
          {onDecline && (
            <button type="button" className={authLink} onClick={onDecline} disabled={busy} data-testid="owner-pin-decline">
              Không dùng PIN trên máy này
            </button>
          )}
        </div>
      </div>
    </OwnerAuthShell>
  );
}

/** Ô icon cam nhạt + tiêu đề + mô tả (Figma R11b / T19b). */
export function PinHeader({ icon: Icon, title, intro }: { icon: LucideIcon; title: string; intro: string }) {
  return (
    <>
      <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ffeee7] text-[#c2380a]">
        <Icon className="h-[26px] w-[26px]" />
      </span>
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold leading-[30px] tracking-normal">{title}</h1>
        <p className="text-sm leading-[21px] text-[#888]">{intro}</p>
      </header>
    </>
  );
}
