import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { parseCountInput, parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { localDb } from '@/lib/localdb';
import { TextField, errorMessage } from '@/app/ui';
import { closeShift } from '@/sync';
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
        <p className="text-4xl font-bold">Đã đóng ca</p>
        <button type="button" className="btn min-w-[200px] border border-stone-300 bg-white" onClick={() => navigate('/', { replace: true })} data-testid="shift-closed-done">
          Xong
        </button>
      </main>
    );
  }
  if (!shift) return <Navigate to="/" replace />;

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
      await closeShift(localDb, { boxes_left: boxesN, plates_left: platesN, cash_counted: cashN });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
      setBusy(false);
    }
  }

  return (
    <main data-testid="close-shift-screen" className="mx-auto flex h-full max-w-xl flex-col gap-6 overflow-y-auto p-6">
      <h2 className="text-3xl font-bold">Đóng ca – {shift.staff_name}</h2>
      <p className="text-lg text-stone-600">Đếm rồi nhập số thực tế đang có.</p>
      <form className="flex flex-col gap-4" onSubmit={review}>
        <TextField label="Số hộp còn lại" inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value)} disabled={confirming} data-testid="close-boxes" />
        <TextField label="Số dĩa sạch còn lại" inputMode="numeric" value={plates} onChange={(e) => setPlates(e.target.value)} disabled={confirming} data-testid="close-plates" />
        <TextField label="Tiền mặt đếm được" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} disabled={confirming} data-testid="close-cash" />
        <Notice testId="close-error" tone="error">
          {error}
        </Notice>
        {!confirming ? (
          <div className="flex gap-3">
            <Link to="/" className="btn flex flex-1 items-center justify-center border border-stone-300 bg-white" data-testid="close-cancel">
              Quay lại
            </Link>
            <button type="submit" className="btn flex-1 bg-stone-800 text-white" data-testid="close-review">
              Tiếp
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4" data-testid="close-confirm-box">
            <p className="text-lg">
              Hộp: <b>{boxesN}</b> · Dĩa: <b>{platesN}</b> · Tiền mặt: <b>{formatVnd(cashN!)}</b>
            </p>
            <p className="text-base text-stone-600">Đóng ca rồi thì không sửa được nữa.</p>
            <div className="flex gap-3">
              <button type="button" className="btn flex-1 border border-stone-300 bg-white" onClick={() => setConfirming(false)} data-testid="close-edit">
                Sửa lại
              </button>
              <button type="button" className="btn flex-1 bg-red-700 text-white" disabled={busy} onClick={() => void confirm()} data-testid="close-confirm">
                Xác nhận đóng ca
              </button>
            </div>
          </div>
        )}
      </form>
    </main>
  );
}
