import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bike, Check, ChefHat, Clock, Inbox, MapPin, Plus, ShoppingBag, UserRound, UtensilsCrossed, Wallet, type LucideIcon } from 'lucide-react';
import { customerLabel } from '@/domain/debt';
import { itemsSummary } from '@/domain/cart';
import { formatVnd } from '@/domain/money';
import { externalShipBadge, shipFeeLabel } from '@/domain/pricing';
import { buildQueue, type QueueCard, type WaitColor } from '@/domain/queue';
import { hhmm } from '@/domain/time';
import { DINE_LABELS, type DineType, type Order } from '@/domain/types';
import { pos } from '@/lib/pos';
import { errorMessage } from '@/app/ui';
import { useNow } from '@/app/useLive';
import { Notice, useTablet } from './parts';
import { PrintBar, ReprintKitchenButton } from './PrintBar';
import { ENTER_MS, EXIT_MS, canAnimate, playEnter, playExit, useFlip } from './useQueueMotion';

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
  /** Đơn vừa thanh toán trên máy này: hiện lại thoáng qua ở chỗ cũ rồi biến mất. */
  paid?: Order;
  /** Đơn vừa tạo trên máy này: thẻ hiện ra có hiệu ứng. */
  created?: string;
}

type ExitKind = keyof typeof EXIT_MS;

/** Thẻ đang rời hàng đợi (đã thanh toán / bị xóa / máy khác thu): vẫn vẽ ở chỗ cũ tới khi hiệu ứng xong. */
interface Leaving {
  card: QueueCard;
  index: number;
  kind: ExitKind;
  until: number;
}

interface Slot {
  card: QueueCard;
  leaving?: ExitKind;
}

/** Chèn thẻ đang rời vào đúng chỗ cũ trong nhóm. */
function withLeaving(cards: QueueCard[], leaving: Leaving[]): Slot[] {
  const out: Slot[] = cards.map((card) => ({ card }));
  for (const l of [...leaving].sort((a, b) => a.index - b.index)) {
    out.splice(Math.min(l.index, out.length), 0, { card: l.card, leaving: l.kind });
  }
  return out;
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
  const paidId = useRef((location.state as QueueFlash | null)?.paid?.id ?? null);
  const [leaving, setLeaving] = useState<Leaving[]>(() => {
    const paid = (location.state as QueueFlash | null)?.paid;
    if (!paid || !canAnimate() || orders.some((o) => o.id === paid.id)) return [];
    const status = paid.status === 'open' ? 'open' : 'served';
    const index = orders.filter((o) => o.status === status && o.created_at < paid.created_at).length;
    const card: QueueCard = { order: paid, group: status === 'open' ? 'serve' : 'pay', position: 0, waitMinutes: 0, color: 'none' };
    return [{ card, index, kind: 'paid', until: Date.now() + EXIT_MS.paid }];
  });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const settings = catalog?.config ?? DEFAULT_WAIT;
  const queue = buildQueue(orders, now, settings);

  // Đơn mới vào hàng đợi (vừa tạo trên máy này, hoặc máy khác tạo khi đang xem) ⇒ hiệu ứng xuất hiện.
  const [entering, setEntering] = useState<Map<string, number>>(() => {
    const created = (location.state as QueueFlash | null)?.created;
    return created && canAnimate() ? new Map([[created, Date.now() + ENTER_MS]]) : new Map();
  });

  // Đơn rời hàng đợi khi đang xem (máy khác thu / xóa, hoặc vừa thu trên máy này) ⇒ giữ thẻ lại để chạy hiệu ứng.
  const lastCards = useRef<Map<string, { card: QueueCard; index: number }> | null>(null);
  useLayoutEffect(() => {
    const cur = new Map<string, { card: QueueCard; index: number }>();
    for (const list of [queue.serve, queue.pay]) list.forEach((card, index) => cur.set(card.order.id, { card, index }));
    const prev = lastCards.current;
    lastCards.current = cur;
    if (!prev || !canAnimate()) return;
    const added = [...cur.keys()].filter((id) => !prev.has(id));
    if (added.length > 0) {
      setEntering((m) => {
        const next = new Map(m);
        for (const id of added) if (!next.has(id)) next.set(id, Date.now() + ENTER_MS);
        return next;
      });
    }
    const gone = [...prev.entries()].filter(([id]) => !cur.has(id));
    if (gone.length === 0) return;
    setLeaving((l) => [
      ...l,
      ...gone
        .filter(([id]) => !l.some((x) => x.card.order.id === id))
        .map(([id, { card, index }]): Leaving => {
          const kind: ExitKind = id === paidId.current ? 'paid' : 'gone';
          return { card, index, kind, until: Date.now() + EXIT_MS[kind] };
        }),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  useEffect(() => {
    if (leaving.length === 0) return;
    const next = Math.min(...leaving.map((l) => l.until));
    const t = setTimeout(() => setLeaving((l) => l.filter((x) => x.until > Date.now() + 20)), Math.max(0, next - Date.now()));
    return () => clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    if (entering.size === 0) return;
    const next = Math.min(...entering.values());
    const t = setTimeout(
      () => setEntering((m) => new Map([...m].filter(([, until]) => until > Date.now() + 20))),
      Math.max(0, next - Date.now()),
    );
    return () => clearTimeout(t);
  }, [entering]);

  const serveSlots = withLeaving(queue.serve, leaving.filter((l) => l.card.group === 'serve'));
  const paySlots = withLeaving(queue.pay, leaving.filter((l) => l.card.group === 'pay'));

  // Đã ra món ⇒ thẻ bay xuống "Chờ thanh toán"; các thẻ còn lại trượt vào chỗ trống.
  const scrollRef = useRef<HTMLDivElement>(null);
  const slotKey = (s: Slot) => `${s.card.order.id}${s.leaving ? '~' : ''}`;
  useFlip(scrollRef, `${serveSlots.map(slotKey).join(',')}|${paySlots.map(slotKey).join(',')}`);
  const pointName = (id: string) => catalog?.points.find((p) => p.id === id)?.name ?? '';
  const multiPoint = (catalog?.profile.point_ids.length ?? 0) > 1;
  const customerName = (id: string | null) => {
    const c = id ? catalog?.customers.find((x) => x.id === id) : undefined;
    return c ? customerLabel(c) : null;
  };

  async function serve(id: string) {
    setError(null);
    // Thẻ sắp bay sang "Chờ thanh toán": không chạy lại hiệu ứng xuất hiện ở chỗ mới.
    setEntering((m) => (m.has(id) ? new Map([...m].filter(([k]) => k !== id)) : m));
    try {
      await pos.serveOrder(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const renderCard = ({ card: c, leaving: exit }: Slot) => (
    <Card
      key={c.order.id}
      card={c}
      leaving={exit}
      entering={!exit && entering.has(c.order.id)}
      pointName={multiPoint ? pointName(c.order.point_id) : null}
      customerName={customerName(c.order.customer_id)}
      onOpen={() => navigate(`/order/${c.order.id}`)}
      onServe={() => void serve(c.order.id)}
      onPay={() => navigate(`/order/${c.order.id}/pay`)}
    />
  );

  const serveCount = queue?.serve.length ?? 0;
  const payCount = queue?.pay.length ?? 0;
  const empty = serveSlots.length + paySlots.length === 0;

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

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-[120px] md:gap-5 md:p-6">
        <div className="grid grid-cols-2 gap-2.5 md:gap-4">
          <Stat icon={ChefHat} tone="warning" label="Chờ ra món" value={serveCount} />
          <Stat icon={Wallet} tone="brand" label="Chờ thanh toán" value={payCount} />
        </div>
        <PrintBar canReprint={(id) => orders.some((o) => o.id === id)} />
        <Notice testId="queue-flash" tone="ok">
          {flash}
        </Notice>
        <Notice testId="queue-error" tone="error">
          {error}
        </Notice>
        <section data-testid="queue-serve" className={`${empty ? 'hidden' : 'flex'} flex-col gap-3`}>
          <SectionTitle count={serveCount}>Chờ ra món</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">{serveSlots.map(renderCard)}</div>
        </section>
        <section data-testid="queue-pay" className={`${empty ? 'hidden' : 'flex'} flex-col gap-3`}>
          <SectionTitle count={payCount}>Chờ thanh toán</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">{paySlots.map(renderCard)}</div>
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
  leaving,
  entering,
  pointName,
  customerName,
  onOpen,
  onServe,
  onPay,
}: {
  card: QueueCard;
  /** Thẻ đang rời hàng đợi: chỉ để hiện hiệu ứng, không bấm được, không có testid. */
  leaving?: ExitKind;
  /** Đơn vừa vào hàng đợi: chạy hiệu ứng xuất hiện (một lần). */
  entering?: boolean;
  pointName: string | null;
  /** Khách của đơn ship (nếu có chọn). */
  customerName: string | null;
  onOpen: () => void;
  onServe: () => void;
  onPay: () => void;
}) {
  const o = card.order;
  const id = o.id;
  const DineIcon = DINE_ICON[o.dine_type];
  const tid = (k: string) => (leaving ? undefined : `queue-${k}-${id}`);
  const ref = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (leaving && ref.current) playExit(ref.current, overlayRef.current, leaving);
  }, [leaving]);
  useLayoutEffect(() => {
    if (entering && ref.current) playEnter(ref.current);
  }, [entering]);
  return (
    <article
      ref={ref}
      data-testid={tid('card')}
      data-group={card.group}
      data-color={card.color}
      data-position={card.position}
      data-flip-id={leaving ? undefined : id}
      data-flip-group={card.group}
      aria-hidden={leaving ? true : undefined}
      className={`relative flex flex-col gap-3 rounded-2xl border bg-surface p-4 ${CARD_STYLE[card.color]} ${leaving ? 'pointer-events-none' : ''}`}
    >
      {leaving === 'paid' && (
        <div
          ref={overlayRef}
          style={{ opacity: 0 }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit] bg-success-soft text-success-strong"
        >
          <span className="icon-tile h-14 w-14 rounded-full bg-success text-white">
            <Check className="h-8 w-8" strokeWidth={3} />
          </span>
          <span className="text-lg font-bold">Đã thanh toán</span>
        </div>
      )}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-col gap-3 rounded-lg text-left" data-testid={tid('open')}>
        <span className="flex w-full items-center gap-2.5">
          <span className={`icon-tile num h-9 w-9 text-base font-bold ${POS_STYLE[card.color]}`} data-testid={tid('pos')}>
            {leaving === 'paid' ? <Check aria-hidden className="h-5 w-5" strokeWidth={3} /> : card.position}
          </span>
          <span className="min-w-0 flex-1 truncate text-lg font-bold text-ink">
            Đơn #
            <span className="font-mono tracking-wider" data-testid={tid('code')}>
              {o.code}
            </span>
          </span>
          <span className="num shrink-0 text-sm text-ink-subtle">{hhmm(o.created_at)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {o.label && (
            <span className="badge rounded-md bg-brand-soft text-[15px] font-semibold text-brand-deep" data-testid={tid('label')}>
              {o.label}
            </span>
          )}
          {pointName && <span className="badge rounded-md bg-warning-soft text-warning-strong">{pointName}</span>}
          <span
            className={`badge rounded-md ${o.dine_type === 'delivery' ? 'bg-warning-soft text-warning-strong' : 'bg-info-soft text-info-strong'}`}
            data-testid={tid('dine')}
          >
            <DineIcon aria-hidden className="h-3.5 w-3.5" />
            {DINE_LABELS[o.dine_type]}
          </span>
        </span>
        {o.dine_type === 'delivery' && customerName && (
          <span className="flex items-center gap-1.5 truncate text-base font-medium text-ink" data-testid={tid('customer')}>
            <UserRound aria-hidden className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="truncate">{customerName}</span>
          </span>
        )}
        {o.dine_type === 'delivery' && o.address && (
          <span className="flex items-center gap-1.5 truncate text-base text-ink-muted" data-testid={tid('address')}>
            <MapPin aria-hidden className="h-4 w-4 shrink-0" />
            <span className="truncate">{o.address}</span>
          </span>
        )}
        <span className="line-clamp-2 text-base text-ink" data-testid={tid('items')}>
          {itemsSummary(o.items)}
        </span>
      </button>
      {/* Điện thoại hẹp: badge ship + tổng không vừa một hàng ⇒ nhóm bên phải xuống dòng, không đẩy thẻ rộng ra (scroll ngang). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line pt-3">
        <span className={`badge num rounded-md text-[13px] ${WAIT_STYLE[card.color]}`}>
          <Clock aria-hidden className="h-3.5 w-3.5" />
          Chờ <span data-testid={tid('wait')}>{card.waitMinutes} phút</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          {o.ship_mode === 'external' ? (
            <span className="badge num rounded-md bg-danger-soft text-[13px] font-semibold text-danger-strong" data-testid={tid('ship-external')}>
              {externalShipBadge(o.ship_payout)}
            </span>
          ) : o.ship_fee > 0 && (
            <span className="badge num rounded-md bg-warning-soft text-[13px] text-warning-strong" data-testid={tid('ship-fee')}>
              {shipFeeLabel(o.ship_fee)} ship
            </span>
          )}
          <b className="num text-xl font-bold text-ink" data-testid={tid('total')}>
            {formatVnd(o.total)}
          </b>
        </span>
      </div>
      <div className="flex gap-2">
        {card.group === 'serve' ? (
          <button type="button" onClick={onServe} className="btn btn-success min-h-[48px] flex-1 text-base" data-testid={tid('serve-btn')}>
            <ChefHat aria-hidden className="h-5 w-5" />
            Đã ra món
          </button>
        ) : (
          <button type="button" onClick={onPay} className="btn btn-primary min-h-[48px] flex-1 text-base" data-testid={tid('pay-btn')}>
            <Wallet aria-hidden className="h-5 w-5" />
            Thanh toán
          </button>
        )}
        {!leaving && <ReprintKitchenButton orderId={id} code={o.code} testId={tid('reprint')} />}
      </div>
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
