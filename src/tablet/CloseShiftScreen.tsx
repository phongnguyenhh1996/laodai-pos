import { Fragment, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Banknote, ChevronLeft, ChevronRight, CircleCheckBig, CupSoda, Package, Soup, TriangleAlert, type LucideIcon } from 'lucide-react';
import { parseCountInput, parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import type { CountItem } from '@/domain/types';
import { pos } from '@/lib/pos';
import { CLOSE_KEY } from '@/pos';
import { Splash, TextField, errorMessage } from '@/app/ui';
import { Notice, useTablet } from './parts';

/** Ô đếm khi đóng ca, theo thứ tự hiện. Chỉ hiện những thứ ca này đếm (công tắc của quầy, chụp lúc mở ca). */
const COUNT_FIELDS: Array<{ item: CountItem; label: string; short: string; icon: LucideIcon; unit: string; money?: true }> = [
  { item: 'boxes', label: 'Số hộp còn lại', short: 'Hộp', icon: Package, unit: 'hộp' },
  { item: 'plates', label: 'Số dĩa sạch còn lại', short: 'Dĩa', icon: Soup, unit: 'dĩa' },
  { item: 'cans', label: 'Số lon còn lại', short: 'Lon', icon: CupSoda, unit: 'lon' },
  { item: 'cash', label: 'Tiền mặt đếm được', short: 'Tiền mặt', icon: Banknote, unit: 'đ', money: true },
];
const TEST_ID: Record<CountItem, string> = { boxes: 'close-boxes', plates: 'close-plates', cans: 'close-cans', cash: 'close-cash' };

/**
 * Đóng ca, đếm mù (mục 4.6): nhân viên nhập số còn lại của những thứ quầy bật đếm (hộp, dĩa sạch, lon, tiền mặt) → Xác nhận.
 * Sau đó chỉ hiện "Đã đóng ca": không có số kỳ vọng hay chênh lệch nào trên tablet (server tính đối soát).
 * Không chặn khi còn đơn mở: đơn đó chuyển tiếp sang ca sau.
 */
export function CloseShiftScreen() {
  const { shift } = useTablet();
  const navigate = useNavigate();
  const [values, setValues] = useState<Partial<Record<CountItem, string>>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <main data-testid="shift-closed" className="flex h-full flex-col items-center justify-center gap-8 p-6">
        <span aria-hidden className="flex h-20 w-20 items-center justify-center rounded-full bg-success-tint text-success">
          <CircleCheckBig className="h-11 w-11" />
        </span>
        <p className="text-4xl font-bold">Đã đóng ca</p>
        <button type="button" className="btn btn-primary min-w-[200px]" onClick={() => navigate('/', { replace: true })} data-testid="shift-closed-done">
          Xong
        </button>
      </main>
    );
  }
  // Đang gửi đóng ca: ca vừa đóng trên server (store đã bỏ ca) nhưng chưa chuyển sang "Đã đóng ca".
  if (!shift) return busy ? <Splash /> : <Navigate to="/" replace />;

  const fields = COUNT_FIELDS.filter((f) => shift.count_items.includes(f.item));
  const parsed = fields.map((f) => ({ ...f, n: (f.money ? parseMoneyInput : parseCountInput)(values[f.item] ?? '') }));
  const valid = parsed.every((f) => f.n !== null);

  function review(e: FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError(fields.length === 1 ? 'Nhập bằng số (0 nếu hết).' : `Nhập đủ ${fields.length} ô bằng số (0 nếu hết).`);
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await pos.closeShift(Object.fromEntries(parsed.map((f) => [CLOSE_KEY[f.item], f.n!])));
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
      setBusy(false);
    }
  }

  const Step = ({ n, label, on }: { n: number; label: string; on: boolean }) => (
    <span className={`flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm ${on ? 'bg-brand-soft font-semibold text-brand-deep' : 'bg-surface-muted font-medium text-ink-muted'}`}>
      <span className={`num flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-bold ${on ? 'bg-brand-strong text-white' : 'bg-line text-ink-muted'}`}>{n}</span>
      {label}
    </span>
  );

  return (
    <main data-testid="close-shift-screen" className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 md:h-[76px] md:px-6">
        <Link to="/" className="btn btn-secondary min-h-[44px] pl-3 pr-4 text-[15px] md:hidden">
          <ChevronLeft aria-hidden className="h-5 w-5" />
          Hàng đợi
        </Link>
        <h2 className="ml-auto text-[19px] font-bold md:ml-0 md:text-xl">Đóng ca</h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface md:items-center md:bg-transparent md:p-6">
        <form className="flex w-full flex-col gap-4 p-4 md:max-w-[560px] md:gap-5 md:rounded-[20px] md:border md:border-line md:bg-surface md:p-7 md:shadow-card" onSubmit={review}>
          <div className="flex items-center gap-2">
            <Step n={1} label="Đếm mù" on={!confirming} />
            <ChevronRight aria-hidden className="h-4 w-4 text-ink-subtle" />
            <Step n={2} label="Xác nhận" on={confirming} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-2xl font-bold md:text-[26px]">Đóng ca – {shift.staff_name}</h3>
            <p className="text-[15px] text-ink-subtle">{fields.length ? 'Đếm rồi nhập số thực tế đang có.' : 'Quầy này không cần đếm gì khi đóng ca.'}</p>
          </div>
          {fields.map((f) => (
            <TextField
              key={f.item}
              label={f.label}
              icon={f.icon}
              suffix={f.unit}
              inputMode="numeric"
              placeholder="0"
              value={values[f.item] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.item]: e.target.value }))}
              disabled={confirming}
              data-testid={TEST_ID[f.item]}
            />
          ))}
          <Notice testId="close-error" tone="error">
            {error}
          </Notice>
          {!confirming ? (
            <div className="flex gap-3">
              <Link to="/" className="btn btn-secondary flex-1" data-testid="close-cancel">
                <ChevronLeft aria-hidden className="h-5 w-5" />
                Quay lại
              </Link>
              <button type="submit" className="btn btn-primary flex-1" data-testid="close-review">
                Tiếp
                <ChevronRight aria-hidden className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-warning-line bg-warning-soft p-4" data-testid="close-confirm-box">
              {parsed.length > 0 && (
                <p className="text-lg">
                  {parsed.map((f, i) => (
                    <Fragment key={f.item}>
                      {i > 0 && ' · '}
                      {f.short}: <b>{f.money ? formatVnd(f.n!) : f.n}</b>
                    </Fragment>
                  ))}
                </p>
              )}
              <p className="flex items-center gap-2 text-base font-medium text-warning-strong">
                <TriangleAlert aria-hidden className="h-5 w-5 shrink-0" />
                Đóng ca rồi thì không sửa được nữa.
              </p>
              <div className="flex gap-3">
                <button type="button" className="btn btn-secondary flex-1" onClick={() => setConfirming(false)} data-testid="close-edit">
                  Sửa lại
                </button>
                <button type="button" className="btn btn-danger flex-1" disabled={busy} onClick={() => void confirm()} data-testid="close-confirm">
                  Xác nhận đóng ca
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
