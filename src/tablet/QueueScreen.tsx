import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChefHat, Clock, HandCoins, MapPin, Plus, Power, Wallet } from 'lucide-react';
import { itemsSummary } from '@/domain/cart';
import { formatVnd } from '@/domain/money';
import { buildQueue, type QueueCard, type WaitColor } from '@/domain/queue';
import { hhmm } from '@/domain/time';
import { DINE_LABELS } from '@/domain/types';
import { pos } from '@/lib/pos';
import { errorMessage } from '@/app/ui';
import { useNow } from '@/app/useLive';
import { Notice, useTablet } from './parts';

const DEFAULT_WAIT = { wait_yellow_min: 5, wait_red_min: 10 };

const CARD_STYLE: Record<WaitColor, string> = {
  none: 'border-line border-l-line-strong bg-surface',
  normal: 'border-line border-l-success bg-surface',
  yellow: 'border-warning-line border-l-warning bg-warning-soft',
  red: 'border-danger-line border-l-danger bg-danger-soft',
};

const POS_STYLE: Record<WaitColor, string> = {
  none: 'bg-ink text-white',
  normal: 'bg-ink text-white',
  yellow: 'bg-warning text-white',
  red: 'bg-danger text-white',
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
  const { catalog, orders } = useTablet();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as QueueFlash | null)?.flash ?? null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const settings = catalog?.config ?? DEFAULT_WAIT;
  const queue = buildQueue(orders, now, settings);
  const pointName = (id: string) => catalog?.points.find((p) => p.id === id)?.name ?? '';
  const multiPoint = (catalog?.profile.point_ids.length ?? 0) > 1;

  async function serve(id: string) {
    setError(null);
    try {
      await pos.serveOrder(id);
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
    <main data-testid="queue-screen" className="flex h-full flex-col-reverse gap-4 overflow-y-auto p-4 md:flex-row md:gap-6 md:overflow-hidden md:p-6">
      <div className="flex flex-col gap-4 md:min-w-0 md:flex-1 md:overflow-y-auto md:pr-1">
        <Notice testId="queue-flash" tone="ok">
          {flash}
        </Notice>
        <Notice testId="queue-error" tone="error">
          {error}
        </Notice>
        <section data-testid="queue-serve" className="flex flex-col gap-3">
          <SectionTitle icon={<ChefHat className="h-5 w-5" />} count={queue?.serve.length ?? 0}>
            Chờ ra món
          </SectionTitle>
          {queue?.serve.map(renderCard)}
        </section>
        <section data-testid="queue-pay" className="mt-2 flex flex-col gap-3">
          <SectionTitle icon={<Wallet className="h-5 w-5" />} count={queue?.pay.length ?? 0}>
            Chờ thanh toán
          </SectionTitle>
          {queue?.pay.map(renderCard)}
        </section>
        {queue && queue.serve.length + queue.pay.length === 0 && (
          <p data-testid="queue-empty" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong py-12 text-center text-xl text-ink-subtle">
            <ChefHat aria-hidden className="h-10 w-10 opacity-60" />
            Chưa có đơn nào đang chờ.
          </p>
        )}
      </div>

      <aside className="grid shrink-0 grid-cols-2 gap-3 md:flex md:w-64 md:flex-col">
        <Link to="/order/new" className="btn btn-primary col-span-2 min-h-[88px] flex-col rounded-2xl text-3xl shadow-card md:min-h-[140px]" data-testid="new-order">
          <Plus aria-hidden className="h-10 w-10" strokeWidth={2.5} />
          Đơn mới
        </Link>
        <div className="hidden flex-1 md:block" />
        <Link to="/debt" className="btn btn-secondary justify-start" data-testid="open-debt">
          <HandCoins aria-hidden className="h-5 w-5 text-ink-muted" />
          Thu nợ
        </Link>
        <Link to="/shift/close" className="btn btn-secondary justify-start" data-testid="open-close-shift">
          <Power aria-hidden className="h-5 w-5 text-ink-muted" />
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
      className={`flex items-stretch gap-3 rounded-2xl border border-l-[6px] p-3 shadow-card ${CARD_STYLE[card.color]}`}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 text-left" data-testid={`queue-open-${id}`}>
        <span className={`num flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold ${POS_STYLE[card.color]}`} data-testid={`queue-pos-${id}`}>
          {card.position}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-2xl font-bold text-ink">
              Đơn #
              <span className="font-mono tracking-wider" data-testid={`queue-code-${id}`}>
                {o.code}
              </span>
            </span>
            {o.label && (
              <span className="badge bg-brand-soft text-lg font-semibold text-brand-deep" data-testid={`queue-label-${id}`}>
                {o.label}
              </span>
            )}
            {pointName && <span className="badge bg-info-soft text-info">{pointName}</span>}
            <span
              className={`badge ${o.dine_type === 'delivery' ? 'bg-warning-soft text-warning-strong' : 'bg-surface-sunken text-ink-muted'}`}
              data-testid={`queue-dine-${id}`}
            >
              {DINE_LABELS[o.dine_type]}
            </span>
          </span>
          {o.dine_type === 'delivery' && o.address && (
            <span className="flex items-center gap-1.5 truncate text-base text-ink-muted" data-testid={`queue-address-${id}`}>
              <MapPin aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">{o.address}</span>
            </span>
          )}
          <span className="mt-0.5 truncate text-lg text-ink" data-testid={`queue-items-${id}`}>
            {itemsSummary(o.items)}
          </span>
          <span className="num flex items-center gap-1.5 text-base text-ink-subtle">
            <Clock aria-hidden className="h-4 w-4" />
            {hhmm(o.created_at)} · chờ <b data-testid={`queue-wait-${id}`}>{card.waitMinutes} phút</b> ·{' '}
            <b className="text-ink" data-testid={`queue-total-${id}`}>
              {formatVnd(o.total)}
            </b>
          </span>
        </span>
      </button>
      {card.group === 'serve' ? (
        <button type="button" onClick={onServe} className="btn btn-success shrink-0 px-6" data-testid={`queue-serve-btn-${id}`}>
          Đã ra món
        </button>
      ) : (
        <button type="button" onClick={onPay} className="btn btn-primary shrink-0 px-6" data-testid={`queue-pay-btn-${id}`}>
          Thanh toán
        </button>
      )}
    </article>
  );
}

function SectionTitle({ icon, count, children }: { icon: ReactNode; count: number; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-muted">
      <span aria-hidden className="text-ink-subtle">
        {icon}
      </span>
      {children}
      <span className="badge num bg-surface-sunken text-base text-ink">{count}</span>
    </h2>
  );
}
