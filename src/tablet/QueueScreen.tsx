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

/** Thu nợ / Đóng ca: điện thoại là ô nhỏ (biểu tượng trên, chữ dưới) cạnh "Đơn mới"; tablet là nút dài. */
const SIDE_BTN = 'btn btn-secondary w-[72px] flex-col gap-0.5 px-1 text-sm md:w-auto md:flex-row md:justify-start md:gap-2 md:px-4 md:text-lg';

/** Nút trên thẻ đơn: điện thoại thấp hơn, nằm dưới nội dung; tablet là cột bên phải như cũ. */
const CARD_BTN = 'min-h-[48px] w-full text-base md:min-h-tap md:w-auto md:shrink-0 md:px-6 md:text-lg';

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
    // Điện thoại: hàng đợi cuộn, thanh "Đơn mới" luôn nằm dưới đáy (trong tầm ngón cái). Tablet: cột nút bên phải.
    <main data-testid="queue-screen" className="flex h-full flex-col md:flex-row md:gap-6 md:p-6">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:min-w-0 md:p-0 md:pr-1">
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

      <aside className="flex shrink-0 gap-2 border-t border-line bg-surface p-3 shadow-raised md:w-64 md:flex-col md:gap-3 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <Link
          to="/order/new"
          className="btn btn-primary order-last min-h-[64px] flex-1 rounded-2xl text-2xl shadow-card md:order-none md:min-h-[140px] md:flex-none md:flex-col md:text-3xl"
          data-testid="new-order"
        >
          <Plus aria-hidden className="h-8 w-8 md:h-10 md:w-10" strokeWidth={2.5} />
          Đơn mới
        </Link>
        <div className="hidden flex-1 md:block" />
        <Link to="/debt" className={SIDE_BTN} data-testid="open-debt">
          <HandCoins aria-hidden className="h-5 w-5 text-ink-muted" />
          Thu nợ
        </Link>
        <Link to="/shift/close" className={SIDE_BTN} data-testid="open-close-shift">
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
  // Điện thoại: nút thao tác xuống hàng dưới, rộng hết thẻ, để chữ của đơn không bị ép hẹp.
  return (
    <article
      data-testid={`queue-card-${id}`}
      data-group={card.group}
      data-color={card.color}
      data-position={card.position}
      className={`flex flex-col gap-2 rounded-2xl border border-l-[6px] p-3 shadow-card md:flex-row md:items-stretch md:gap-3 ${CARD_STYLE[card.color]}`}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left md:gap-4" data-testid={`queue-open-${id}`}>
        <span
          className={`num flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl font-bold md:h-14 md:w-14 md:rounded-2xl md:text-2xl ${POS_STYLE[card.color]}`}
          data-testid={`queue-pos-${id}`}
        >
          {card.position}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-baseline gap-x-2 md:gap-x-3">
            <span className="text-xl font-bold text-ink md:text-2xl">
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
          <span className="mt-0.5 line-clamp-2 text-base text-ink md:truncate md:text-lg" data-testid={`queue-items-${id}`}>
            {itemsSummary(o.items)}
          </span>
          <span className="num flex flex-wrap items-center gap-x-1.5 text-sm text-ink-subtle md:text-base">
            <Clock aria-hidden className="h-4 w-4" />
            {hhmm(o.created_at)} · chờ <b data-testid={`queue-wait-${id}`}>{card.waitMinutes} phút</b> ·{' '}
            <b className="text-ink" data-testid={`queue-total-${id}`}>
              {formatVnd(o.total)}
            </b>
          </span>
        </span>
      </button>
      {card.group === 'serve' ? (
        <button type="button" onClick={onServe} className={`btn btn-success ${CARD_BTN}`} data-testid={`queue-serve-btn-${id}`}>
          Đã ra món
        </button>
      ) : (
        <button type="button" onClick={onPay} className={`btn btn-primary ${CARD_BTN}`} data-testid={`queue-pay-btn-${id}`}>
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
