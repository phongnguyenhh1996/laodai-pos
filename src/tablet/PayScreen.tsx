import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { canConfirmCash, changeDue, quickCashOptions } from '@/domain/cash';
import { itemsSummary } from '@/domain/cart';
import { parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import type { Order } from '@/domain/types';
import { localDb } from '@/lib/localdb';
import { Splash, errorMessage } from '@/app/ui';
import { getOpenOrder, payOrder, type PaymentInput } from '@/sync';
import { Notice } from './parts';
import type { QueueFlash } from './QueueScreen';

type Method = 'cash' | 'transfer';

/**
 * Thanh toán (mục 4.4): một hình thức cho cả đơn. Tiền tính vào ca đang mở lúc thu.
 * Thanh toán xong đơn biến mất khỏi tablet, nhân viên không sửa / xem lại được nữa.
 */
export function PayScreen() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [method, setMethod] = useState<Method>('cash');
  const [given, setGiven] = useState<number | null>(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void getOpenOrder(localDb, orderId ?? '').then((o) => {
      if (!alive) return;
      if (!o) navigate('/', { replace: true });
      else setOrder(o);
    });
    return () => {
      alive = false;
    };
  }, [orderId, navigate]);

  if (!order) return <Splash />;
  const o = order;
  const change = changeDue(o.total, given);

  function pickQuick(amount: number) {
    setManual('');
    setGiven(amount);
  }

  function typeManual(raw: string) {
    setManual(raw);
    setGiven(parseMoneyInput(raw));
  }

  async function confirm(payment: PaymentInput, flash: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await payOrder(localDb, o.id, payment);
      navigate('/', { replace: true, state: { flash } satisfies QueueFlash });
    } catch (e) {
      setError(errorMessage(e));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <main data-testid="pay-screen" className="mx-auto flex h-full max-w-4xl flex-col gap-5 overflow-y-auto p-6">
      <header className="flex items-center justify-between gap-4">
        <Link to={`/order/${o.id}`} className="btn flex items-center border border-stone-300 bg-white" data-testid="pay-back">
          ‹ Đơn
        </Link>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold tracking-wider" data-testid="pay-code">
            {o.code}
            {o.label ? ` · ${o.label}` : ''}
          </p>
          <p className="text-lg text-stone-600">{itemsSummary(o.items)}</p>
        </div>
      </header>

      <div className="flex items-baseline justify-between rounded-2xl bg-white p-5">
        <span className="text-2xl text-stone-600">Cần thu</span>
        <span className="text-5xl font-bold" data-testid="pay-total">
          {formatVnd(o.total)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3" role="tablist">
        {(
          [
            ['cash', 'Tiền mặt'],
            ['transfer', 'Chuyển khoản'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={method === m}
            onClick={() => setMethod(m)}
            className={`btn min-h-[64px] border text-xl ${method === m ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white'}`}
            data-testid={`pay-method-${m}`}
          >
            {label}
          </button>
        ))}
      </div>

      {method === 'cash' ? (
        <section className="flex flex-col gap-4" data-testid="pay-cash">
          <h2 className="text-xl text-stone-600">Khách đưa</h2>
          <div className="grid grid-cols-3 gap-3">
            {quickCashOptions(o.total).map((q) => (
              <button
                key={q.amount}
                type="button"
                aria-pressed={given === q.amount && manual === ''}
                onClick={() => pickQuick(q.amount)}
                className={`btn min-h-[64px] border text-xl ${given === q.amount && manual === '' ? 'border-amber-700 bg-amber-700 text-white' : 'border-stone-300 bg-white'}`}
                data-testid={q.kind === 'exact' ? 'cash-exact' : `cash-quick-${q.amount}`}
              >
                {q.kind === 'exact' ? 'Đủ tiền' : formatVnd(q.amount)}
              </button>
            ))}
            <input
              className="min-h-[64px] rounded-xl border border-stone-300 px-4 text-xl outline-none focus:border-amber-600"
              inputMode="numeric"
              placeholder="Nhập tay"
              value={manual}
              onChange={(e) => typeManual(e.target.value)}
              data-testid="cash-manual"
            />
          </div>
          <div className="flex items-baseline justify-between rounded-2xl bg-white p-5">
            <span className="text-2xl text-stone-600">Tiền thối</span>
            <span className="text-4xl font-bold" data-testid="cash-change">
              {change === null ? (given === null ? '—' : 'Chưa đủ') : formatVnd(change)}
            </span>
          </div>
          <Notice testId="pay-error" tone="error">
            {error}
          </Notice>
          <button
            type="button"
            className="btn min-h-[72px] bg-emerald-700 text-2xl text-white"
            disabled={!canConfirmCash(o.total, given) || busy}
            onClick={() => void confirm({ method: 'cash', cash_given: given! }, `Đã thu ${formatVnd(o.total)} – đơn ${o.code}`)}
            data-testid="pay-confirm"
          >
            Đã thu tiền
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-4" data-testid="pay-transfer">
          <p className="text-xl text-stone-600">Kiểm tra đã nhận đủ {formatVnd(o.total)} trên điện thoại / loa báo rồi mới bấm.</p>
          <Notice testId="pay-error" tone="error">
            {error}
          </Notice>
          <button
            type="button"
            className="btn min-h-[72px] bg-emerald-700 text-2xl text-white"
            disabled={busy}
            onClick={() => void confirm({ method: 'transfer' }, `Đã nhận chuyển khoản – đơn ${o.code}`)}
            data-testid="pay-transfer-confirm"
          >
            Đã nhận chuyển khoản
          </button>
        </section>
      )}
    </main>
  );
}
