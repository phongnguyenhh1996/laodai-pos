import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bike, ChefHat, Clock, Inbox, MapPin, Plus, ShoppingBag, UtensilsCrossed, Wallet, type LucideIcon } from 'lucide-react';
import { itemsSummary } from '@/domain/cart';
import { formatVnd } from '@/domain/money';
import { buildQueue, type QueueCard, type WaitColor } from '@/domain/queue';
import { hhmm } from '@/domain/time';
import { DINE_LABELS, type DineType } from '@/domain/types';
import { pos } from '@/lib/pos';
import { errorMessage } from '@/app/ui';
import { useNow } from '@/app/useLive';
import { Notice, useTablet } from './parts';

const DEFAULT_WAIT = { wait_yellow_min: 5, wait_red_min: 10 };

/** Thẻ đơn (Makaryo): nền trắng; đơn chờ lâu viền vàng / đỏ. */
const CARD_STYLE: Record<WaitColor, string> = {
  none: 'border-line',
  normal: 'border-line',
  yellow: 'border-warning-line ring-1 ring-inset ring-warning-line',
  red: 'border-danger-line ring-1 ring-inset ring-danger-line',
};

/** Ô số thứ tự + nhãn "Chờ … phút" cùng màu theo thời gian chờ. */
const POS_STYLE: Record<WaitColor, string> = {
  none: 'bg-surface-sunken text-ink',
  normal: 'bg-success-soft text-success-strong',
  yellow: 'bg-warning-tint text-warning-strong',
  red: 'bg-danger-soft text-danger-strong',
};
const WAIT_STYLE: Record<WaitColor, string> = {
  none: 'bg-surface-sunken text-ink-muted',
  normal: 'bg-success-soft text-success-strong',
  yellow: 'bg-warning-soft text-warning-strong',
  red: 'bg-danger-soft text-danger-strong',
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

  const serveCount = queue?.serve.length ?? 0;
  const payCount = queue?.pay.length ?? 0;
  const empty = !!queue && serveCount + payCount === 0;

  return (
    // Tablet: thanh trên (tiêu đề + Đơn mới), số liệu, lưới thẻ đơn. Điện thoại: danh sách cuộn, chừa chỗ cho thanh đáy (TabletHome).
    <main data-testid="queue-screen" className="flex h-full flex-col">
      <div className="hidden h-[76px] shrink-0 items-center gap-2.5 border-b border-line bg-surface px-6 md:flex">
        <h2 className="text-2xl font-bold">Hàng đợi</h2>
        <span className="num text-base text-ink-subtle">({serveCount + payCount} đơn)</span>
        <span className="flex-1" />
        <Link to="/order/new" className="btn btn-primary min-h-[48px] px-5 text-[17px]">
          <Plus aria-hidden className="h-5 w-5" strokeWidth={2.5} />
          Đơn mới
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-[120px] md:gap-5 md:p-6">
        <div className="grid grid-cols-2 gap-2.5 md:gap-4">
          <Stat icon={ChefHat} tone="warning" label="Chờ ra món" value={serveCount} />
          <Stat icon={Wallet} tone="brand" label="Chờ thanh toán" value={payCount} />
        </div>
        <Notice testId="queue-flash" tone="ok">
          {flash}
        </Notice>
        <Notice testId="queue-error" tone="error">
          {error}
        </Notice>
        <section data-testid="queue-serve" className={`${empty ? 'hidden' : 'flex'} flex-col gap-3`}>
          <SectionTitle count={serveCount}>Chờ ra món</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">{queue?.serve.map(renderCard)}</div>
        </section>
        <section data-testid="queue-pay" className={`${empty ? 'hidden' : 'flex'} flex-col gap-3`}>
          <SectionTitle count={payCount}>Chờ thanh toán</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">{queue?.pay.map(renderCard)}</div>
        </section>
        {empty && (
          <div data-testid="queue-empty" className="card flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <span aria-hidden className="icon-tile h-16 w-16 rounded-full bg-brand-soft text-brand md:h-[72px] md:w-[72px]">
              <Inbox className="h-8 w-8" />
            </span>
            <p className="text-xl font-semibold">Chưa có đơn nào đang chờ.</p>
            <p className="max-w-[420px] text-base text-ink-subtle">Bấm “Đơn mới” để bắt đầu bán. Đơn chờ ra món / chờ thanh toán sẽ hiện ở đây.</p>
          </div>
        )}
      </div>
    </main>
  );
}

const STAT_TONE = {
  warning: 'bg-warning-soft text-warning',
  brand: 'bg-brand-soft text-brand',
} as const;

function Stat({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: keyof typeof STAT_TONE; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-2.5 py-3 md:gap-3.5 md:px-[18px] md:py-4">
      <span aria-hidden className={`icon-tile h-9 w-9 rounded-full md:h-12 md:w-12 ${STAT_TONE[tone]}`}>
        <Icon className="h-5 w-5 md:h-6 md:w-6" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] text-ink-subtle md:text-sm">{label}</span>
        <span className="num text-[22px] font-bold leading-tight md:text-[26px]">{value}</span>
      </span>
    </div>
  );
}

const DINE_ICON: Record<DineType, LucideIcon> = { dinein: UtensilsCrossed, takeaway: ShoppingBag, delivery: Bike };

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
  const DineIcon = DINE_ICON[o.dine_type];
  return (
    <article
      data-testid={`queue-card-${id}`}
      data-group={card.group}
      data-color={card.color}
      data-position={card.position}
      className={`flex flex-col gap-3 rounded-2xl border bg-surface p-4 ${CARD_STYLE[card.color]}`}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-col gap-3 rounded-lg text-left" data-testid={`queue-open-${id}`}>
        <span className="flex w-full items-center gap-2.5">
          <span className={`icon-tile num h-9 w-9 text-base font-bold ${POS_STYLE[card.color]}`} data-testid={`queue-pos-${id}`}>
            {card.position}
          </span>
          <span className="min-w-0 flex-1 truncate text-lg font-bold text-ink">
            Đơn #
            <span className="font-mono tracking-wider" data-testid={`queue-code-${id}`}>
              {o.code}
            </span>
          </span>
          <span className="num shrink-0 text-sm text-ink-subtle">{hhmm(o.created_at)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {o.label && (
            <span className="badge rounded-md bg-brand-soft text-[15px] font-semibold text-brand-deep" data-testid={`queue-label-${id}`}>
              {o.label}
            </span>
          )}
          {pointName && <span className="badge rounded-md bg-warning-soft text-warning-strong">{pointName}</span>}
          <span
            className={`badge rounded-md ${o.dine_type === 'delivery' ? 'bg-warning-soft text-warning-strong' : 'bg-info-soft text-info-strong'}`}
            data-testid={`queue-dine-${id}`}
          >
            <DineIcon aria-hidden className="h-3.5 w-3.5" />
            {DINE_LABELS[o.dine_type]}
          </span>
        </span>
        {o.dine_type === 'delivery' && o.address && (
          <span className="flex items-center gap-1.5 truncate text-base text-ink-muted" data-testid={`queue-address-${id}`}>
            <MapPin aria-hidden className="h-4 w-4 shrink-0" />
            <span className="truncate">{o.address}</span>
          </span>
        )}
        <span className="line-clamp-2 text-base text-ink" data-testid={`queue-items-${id}`}>
          {itemsSummary(o.items)}
        </span>
      </button>
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <span className={`badge num rounded-md text-[13px] ${WAIT_STYLE[card.color]}`}>
          <Clock aria-hidden className="h-3.5 w-3.5" />
          Chờ <span data-testid={`queue-wait-${id}`}>{card.waitMinutes} phút</span>
        </span>
        <span className="flex-1" />
        <b className="num text-xl font-bold text-ink" data-testid={`queue-total-${id}`}>
          {formatVnd(o.total)}
        </b>
      </div>
      {card.group === 'serve' ? (
        <button type="button" onClick={onServe} className="btn btn-success min-h-[48px] w-full text-base" data-testid={`queue-serve-btn-${id}`}>
          <ChefHat aria-hidden className="h-5 w-5" />
          Đã ra món
        </button>
      ) : (
        <button type="button" onClick={onPay} className="btn btn-primary min-h-[48px] w-full text-base" data-testid={`queue-pay-btn-${id}`}>
          <Wallet aria-hidden className="h-5 w-5" />
          Thanh toán
        </button>
      )}
    </article>
  );
}

function SectionTitle({ count, children }: { count: number; children: ReactNode }) {
  return (
    <h2 className="flex items-baseline gap-2 text-lg font-bold md:text-xl">
      {children}
      <span className="num text-base font-normal text-ink-subtle">({count})</span>
    </h2>
  );
}
