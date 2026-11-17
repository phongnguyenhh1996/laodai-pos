import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { itemsSummary } from '@/domain/cart';
import { formatVnd } from '@/domain/money';
import { buildQueue, type QueueCard, type WaitColor } from '@/domain/queue';
import { hhmm } from '@/domain/time';
import { localDb } from '@/lib/localdb';
import { errorMessage } from '@/app/ui';
import { useLive, useNow } from '@/app/useLive';
import { serveOrder, visibleOrders } from '@/sync';
import { Notice, useTablet } from './parts';

const DEFAULT_WAIT = { wait_yellow_min: 5, wait_red_min: 10 };

const CARD_STYLE: Record<WaitColor, string> = {
  none: 'border-stone-200 bg-white',
  normal: 'border-stone-200 bg-white',
  yellow: 'border-amber-400 bg-amber-100',
  red: 'border-red-500 bg-red-100',
};

/** Thông báo ngắn sau khi thanh toán / xóa đơn, truyền qua state của điều hướng. */
export interface QueueFlash {
  flash?: string;
}

/**
 * Hàng đợi (mục 4.3), màn hình chính khi có ca: "Chờ ra món" ở trên, "Chờ thanh toán" ở dưới,
 * cũ nhất ở trên, số thứ tự đánh liên tục. Không có gì về doanh thu hay số đơn đã bán.
 */
export function QueueScreen() {
  const { catalog } = useTablet();
  const navigate = useNavigate();
  const location = useLocation();
  const orders = useLive(() => visibleOrders(localDb), []);
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as QueueFlash | null)?.flash ?? null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const settings = catalog?.config ?? DEFAULT_WAIT;
  const queue = orders.status === 'ready' ? buildQueue(orders.value, now, settings) : null;
  const pointName = (id: string) => catalog?.points.find((p) => p.id === id)?.name ?? '';
  const multiPoint = (catalog?.profile.point_ids.length ?? 0) > 1;

  async function serve(id: string) {
    setError(null);
    try {
      await serveOrder(localDb, id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const renderCard = (c: QueueCard) => (
    <Card
      key={c.order.id}
      card={c}
      pointName={multiPoint ? pointName(c.order.point_id) : null}
      onOpen={() => navigate(`/order/${c.order.id}`)}
      onServe={() => void serve(c.order.id)}
      onPay={() => navigate(`/order/${c.order.id}/pay`)}
    />
  );

  return (
    <main data-testid="queue-screen" className="flex h-full gap-6 p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <Notice testId="queue-flash" tone="ok">
          {flash}
        </Notice>
        <Notice testId="queue-error" tone="error">
          {error}
        </Notice>
        <section data-testid="queue-serve" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-stone-600">Chờ ra món ({queue?.serve.length ?? 0})</h2>
          {queue?.serve.map(renderCard)}
        </section>
        <section data-testid="queue-pay" className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-stone-600">Chờ thanh toán ({queue?.pay.length ?? 0})</h2>
          {queue?.pay.map(renderCard)}
        </section>
        {queue && queue.serve.length + queue.pay.length === 0 && (
          <p data-testid="queue-empty" className="py-8 text-center text-xl text-stone-400">
            Chưa có đơn nào đang chờ.
          </p>
        )}
      </div>

      <aside className="flex w-64 shrink-0 flex-col gap-3">
        <Link to="/order/new" className="btn flex min-h-[120px] items-center justify-center bg-amber-700 text-3xl text-white" data-testid="new-order">
          + Đơn mới
        </Link>
        <div className="flex-1" />
        <Link to="/shift/close" className="btn flex items-center justify-center border border-stone-300 bg-white" data-testid="open-close-shift">
          Đóng ca
        </Link>
      </aside>
    </main>
  );
}

function Card({
  card,
  pointName,
  onOpen,
  onServe,
  onPay,
}: {
  card: QueueCard;
  pointName: string | null;
  onOpen: () => void;
  onServe: () => void;
  onPay: () => void;
}) {
  const o = card.order;
  const id = o.id;
  return (
    <article
      data-testid={`queue-card-${id}`}
      data-group={card.group}
      data-color={card.color}
      data-position={card.position}
      className={`flex items-stretch gap-3 rounded-2xl border-2 p-3 ${CARD_STYLE[card.color]}`}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 text-left" data-testid={`queue-open-${id}`}>
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-stone-800 text-2xl font-bold text-white" data-testid={`queue-pos-${id}`}>
          {card.position}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-mono text-2xl font-bold tracking-wider" data-testid={`queue-code-${id}`}>
              {o.code}
            </span>
            {o.label && (
              <span className="text-xl font-semibold text-amber-800" data-testid={`queue-label-${id}`}>
                {o.label}
              </span>
            )}
            {pointName && <span className="text-base text-stone-500">{pointName}</span>}
            <span className="text-base text-stone-500">{o.dine_type === 'dinein' ? 'Tại chỗ' : 'Mang về'}</span>
          </span>
          <span className="truncate text-lg text-stone-700" data-testid={`queue-items-${id}`}>
            {itemsSummary(o.items)}
          </span>
          <span className="text-base text-stone-500">
            {hhmm(o.created_at)} · chờ <b data-testid={`queue-wait-${id}`}>{card.waitMinutes} phút</b> ·{' '}
            <b className="text-stone-800" data-testid={`queue-total-${id}`}>
              {formatVnd(o.total)}
            </b>
          </span>
        </span>
      </button>
      {card.group === 'serve' ? (
        <button type="button" onClick={onServe} className="btn shrink-0 bg-emerald-700 px-6 text-white" data-testid={`queue-serve-btn-${id}`}>
          Đã ra món
        </button>
      ) : (
        <button type="button" onClick={onPay} className="btn shrink-0 bg-amber-700 px-6 text-white" data-testid={`queue-pay-btn-${id}`}>
          Thanh toán
        </button>
      )}
    </article>
  );
}
