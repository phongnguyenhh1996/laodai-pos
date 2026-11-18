import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Banknote, ChevronLeft, ChevronRight, CircleCheckBig, Package, Soup, TriangleAlert } from 'lucide-react';
import { parseCountInput, parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { pos } from '@/lib/pos';
import { Splash, TextField, errorMessage } from '@/app/ui';
import { Notice, useTablet } from './parts';

/**
 * Đóng ca, đếm mù (mục 4.6): nhân viên nhập hộp còn lại, dĩa sạch còn lại, tiền mặt đếm được → Xác nhận.
 * Sau đó chỉ hiện "Đã đóng ca": không có số kỳ vọng hay chênh lệch nào trên tablet (server tính đối soát).
 * Không chặn khi còn đơn mở: đơn đó chuyển tiếp sang ca sau.
 */
export function CloseShiftScreen() {
  const { shift } = useTablet();
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState('');
  const [plates, setPlates] = useState('');
  const [cash, setCash] = useState('');
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

  const boxesN = parseCountInput(boxes);
  const platesN = parseCountInput(plates);
  const cashN = parseMoneyInput(cash);
  const valid = boxesN !== null && platesN !== null && cashN !== null;

  function review(e: FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError('Nhập đủ 3 ô bằng số (0 nếu hết).');
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await pos.closeShift({ boxes_left: boxesN, plates_left: platesN, cash_counted: cashN });
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
            <p className="text-[15px] text-ink-subtle">Đếm rồi nhập số thực tế đang có.</p>
          </div>
          <TextField label="Số hộp còn lại" icon={Package} suffix="hộp" inputMode="numeric" placeholder="0" value={boxes} onChange={(e) => setBoxes(e.target.value)} disabled={confirming} data-testid="close-boxes" />
          <TextField label="Số dĩa sạch còn lại" icon={Soup} suffix="dĩa" inputMode="numeric" placeholder="0" value={plates} onChange={(e) => setPlates(e.target.value)} disabled={confirming} data-testid="close-plates" />
          <TextField label="Tiền mặt đếm được" icon={Banknote} suffix="đ" inputMode="numeric" placeholder="0" value={cash} onChange={(e) => setCash(e.target.value)} disabled={confirming} data-testid="close-cash" />
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
              <p className="text-lg">
                Hộp: <b>{boxesN}</b> · Dĩa: <b>{platesN}</b> · Tiền mặt: <b>{formatVnd(cashN!)}</b>
              </p>
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
