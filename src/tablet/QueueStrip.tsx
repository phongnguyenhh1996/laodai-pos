import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Bike, Check, ChefHat, Clock, Inbox, ShoppingBag, UtensilsCrossed, Wallet, type LucideIcon } from 'lucide-react';
import { formatVnd } from '@/domain/money';
import { externalShipBadge, shipFeeLabel } from '@/domain/pricing';
import { buildQueue, queueCounts, queueStrip, type QueueCard, type QueueFilter, type WaitColor } from '@/domain/queue';
import { DINE_LABELS, type DineType, type Order } from '@/domain/types';
import { useNow } from '@/app/useLive';
import { useTablet } from './parts';
import { PrintBar } from './PrintBar';
import { ENTER_MS, EXIT_MS, canAnimate, playEnter, playExit, useFlip } from './useQueueMotion';

const DEFAULT_WAIT = { wait_yellow_min: 5, wait_red_min: 10 };

/** Thẻ đơn: đơn chờ lâu viền vàng / đỏ; thẻ đang chọn viền cam nổi bật. */
const CARD_STYLE: Record<WaitColor, string> = {
  none: 'border-line',
  normal: 'border-line',
  yellow: 'border-warning-line ring-1 ring-inset ring-warning-line',
  red: 'border-danger-line ring-1 ring-inset ring-danger-line',
};
const SELECTED_STYLE = 'border-brand bg-brand-soft ring-2 ring-brand';

const WAIT_STYLE: Record<WaitColor, string> = {
  none: 'bg-surface-sunken text-ink-muted',
  normal: 'bg-success-soft text-success-strong',
  yellow: 'bg-warning-soft text-warning-strong',
  red: 'bg-danger-soft text-danger-strong',
};

const CHIPS: ReadonlyArray<{ id: QueueFilter; label: string; dot?: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'serve', label: 'Chờ ra món', dot: 'bg-warning' },
  { id: 'pay', label: 'Chờ thanh toán', dot: 'bg-brand' },
];

const DINE_ICON: Record<DineType, LucideIcon> = { dinein: UtensilsCrossed, takeaway: ShoppingBag, delivery: Bike };

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
 * Hàng đợi (mục 4.3) ở đầu màn Bán hàng: chip lọc Tất cả / Chờ ra món / Chờ thanh toán (kèm số đếm)
 * và một hàng thẻ đơn cuộn ngang. Bấm thẻ ⇒ mở đơn đó trong giỏ; bấm lại thẻ đang chọn hoặc vùng trống ⇒ bỏ chọn.
 */
export function QueueStrip({
  selectedId,
  onSelect,
  onDeselect,
  hiddenIds,
  paidId,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  /** Đơn vừa tạo trên máy này và đang thu tiền ngay: không hiện thẻ (thẻ chỉ lóe lên rồi mất). */
  hiddenIds: ReadonlySet<string>;
  /** Đơn vừa thanh toán trên máy này: thẻ rời hàng đợi với dấu tích "Đã thanh toán". */
  paidId: { current: string | null };
}) {
  const { catalog, orders } = useTablet();
  const now = useNow(1000);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const visible = hiddenIds.size > 0 ? orders.filter((o) => !hiddenIds.has(o.id)) : orders;
  const queue = buildQueue(visible, now, catalog?.config ?? DEFAULT_WAIT);
  const counts = queueCounts(queue);

  const [leaving, setLeaving] = useState<Leaving[]>([]);
  // Đơn mới vào hàng đợi (tạo trên máy này hoặc máy khác) ⇒ hiệu ứng xuất hiện.
  const [entering, setEntering] = useState<Map<string, number>>(new Map());

  // So với lần trước: đơn mới vào ⇒ xuất hiện; đơn rời đi ⇒ giữ thẻ lại để chạy hiệu ứng.
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
    // Thẻ đổi nhóm (đã ra món) ⇒ không chạy lại hiệu ứng xuất hiện ở chỗ mới.
    const regrouped = [...cur.entries()].filter(([id, { card }]) => prev.get(id) && prev.get(id)!.card.group !== card.group).map(([id]) => id);
    if (regrouped.length > 0) setEntering((m) => new Map([...m].filter(([k]) => !regrouped.includes(k))));
    const gone = [...prev.entries()].filter(([id]) => !cur.has(id) && !hiddenIds.has(id));
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
  }, [orders, hiddenIds]);

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
  const slots = queueStrip(serveSlots, paySlots, filter);

  // Đã ra món ⇒ thẻ trượt sang chỗ mới; các thẻ còn lại trượt vào chỗ trống.
  const rowRef = useRef<HTMLDivElement>(null);
  const slotKey = (s: Slot) => `${s.card.order.id}${s.leaving ? '~' : ''}`;
  useFlip(rowRef, `${filter}|${slots.map(slotKey).join(',')}`);

  // Thẻ đang chọn luôn nằm trong tầm nhìn của dải.
  useEffect(() => {
    if (!selectedId || !rowRef.current) return;
    const el = rowRef.current.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [selectedId, filter]);

  const multiPoint = (catalog?.profile.point_ids.length ?? 0) > 1;
  const pointName = (id: string) => catalog?.points.find((p) => p.id === id)?.name ?? '';

  /** Bấm vào thẻ / chip không tính là bấm vùng trống. */
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <section
      data-testid="queue-screen"
      aria-label="Hàng đợi"
      onClick={onDeselect}
      className="flex min-w-0 shrink-0 flex-col gap-2 border-b border-line bg-surface py-2.5 md:gap-3 md:py-4"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto px-3 md:gap-2 md:px-5" role="group" aria-label="Lọc đơn">
        {CHIPS.map((c) => {
          const on = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={(e) => {
                stop(e);
                setFilter(c.id);
              }}
              data-testid={`queue-filter-${c.id}`}
              className={`flex min-h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium md:min-h-[40px] md:px-4 md:text-[15px] ${
                on ? 'border-ink-muted bg-surface font-semibold text-ink ring-1 ring-inset ring-ink-muted' : 'border-line bg-surface text-ink-muted'
              }`}
            >
              {c.dot && <span aria-hidden className={`dot h-2 w-2 ${c.dot}`} />}
              {c.label}
              <span className="num rounded-full bg-surface-sunken px-1.5 text-xs font-bold leading-5 text-ink" data-testid={`queue-count-${c.id}`}>
                {counts[c.id]}
              </span>
            </button>
          );
        })}
      </div>

      {slots.length === 0 ? (
        <div
          data-testid="queue-empty"
          className="mx-3 flex h-[64px] items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-[15px] text-ink-subtle md:mx-5 md:h-[104px] md:gap-2.5 md:rounded-2xl md:text-base"
        >
          <Inbox aria-hidden className="h-5 w-5" />
          Chưa có đơn đang mở
        </div>
      ) : (
        <div ref={rowRef} className="flex gap-2 overflow-x-auto px-3 pb-0.5 md:gap-3 md:px-5" data-testid="queue-cards">
          {slots.map(({ card, leaving: exit }) => (
            <Card
              key={card.order.id}
              card={card}
              leaving={exit}
              entering={!exit && entering.has(card.order.id)}
              selected={!exit && card.order.id === selectedId}
              pointName={multiPoint ? pointName(card.order.point_id) : null}
              onClick={(e) => {
                stop(e);
                if (card.order.id === selectedId) onDeselect();
                else onSelect(card.order.id);
              }}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 px-3 empty:hidden md:px-5" onClick={stop}>
        <PrintBar canReprint={(id) => orders.some((o) => o.id === id)} />
      </div>
    </section>
  );
}

function Card({
  card,
  leaving,
  entering,
  selected,
  pointName,
  onClick,
}: {
  card: QueueCard;
  /** Thẻ đang rời hàng đợi: chỉ để hiện hiệu ứng, không bấm được, không có testid. */
  leaving?: ExitKind;
  /** Đơn vừa vào hàng đợi: chạy hiệu ứng xuất hiện (một lần). */
  entering?: boolean;
  selected: boolean;
  pointName: string | null;
  onClick: (e: MouseEvent) => void;
}) {
  const o = card.order;
  const id = o.id;
  const DineIcon = DINE_ICON[o.dine_type];
  const tid = (k: string) => (leaving ? undefined : `queue-${k}-${id}`);
  const qty = o.items.reduce((s, it) => s + it.qty, 0);
  const ref = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (leaving && ref.current) playExit(ref.current, overlayRef.current, leaving);
  }, [leaving]);
  useLayoutEffect(() => {
    if (entering && ref.current) playEnter(ref.current);
  }, [entering]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={!!leaving}
      data-testid={tid('card')}
      data-group={card.group}
      data-color={card.color}
      data-selected={selected || undefined}
      data-flip-id={leaving ? undefined : id}
      data-flip-group={card.group}
      aria-hidden={leaving ? true : undefined}
      aria-pressed={leaving ? undefined : selected}
      aria-label={`Đơn ${o.code}`}
      className={`relative flex h-[64px] w-[140px] shrink-0 flex-col justify-between rounded-xl border px-2.5 py-2 text-left md:h-[104px] md:w-[216px] md:rounded-2xl md:p-3 ${
        selected ? SELECTED_STYLE : `bg-surface ${CARD_STYLE[card.color]}`
      } ${leaving ? 'pointer-events-none' : ''}`}
    >
      {leaving === 'paid' && (
        <span
          ref={overlayRef}
          style={{ opacity: 0 }}
          className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-[inherit] bg-success-soft text-success-strong"
        >
          <span className="icon-tile h-8 w-8 rounded-full bg-success text-white md:h-10 md:w-10">
            <Check className="h-5 w-5" strokeWidth={3} />
          </span>
          <span className="hidden text-base font-bold md:inline">Đã thanh toán</span>
        </span>
      )}
      <span className="flex w-full items-center gap-1.5 md:gap-2">
        <span aria-hidden className={`dot h-2 w-2 shrink-0 md:hidden ${card.group === 'serve' ? 'bg-warning' : 'bg-brand'}`} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold md:text-base">
          <span className="hidden md:inline">#</span>
          <span className="font-mono tracking-wider" data-testid={tid('code')}>
            {o.code}
          </span>
          <span className="font-medium text-ink-muted md:font-semibold">
            {' · '}
            <span data-testid={o.label ? tid('label') : tid('dine')}>{o.label || DINE_LABELS[o.dine_type]}</span>
          </span>
        </span>
        <span className={`badge num hidden shrink-0 rounded-md px-1.5 text-xs md:inline-flex ${WAIT_STYLE[card.color]}`}>
          <Clock aria-hidden className="h-3 w-3" />
          <span data-testid={tid('wait')}>{card.waitMinutes}′</span>
        </span>
      </span>
      <span className="hidden w-full items-center gap-1.5 text-[13px] text-ink-muted md:flex">
        <DineIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="num shrink-0" data-testid={tid('qty')}>
          {qty} món
        </span>
        {pointName && <span className="truncate">· {pointName}</span>}
        <span className="flex-1" />
        <ShipBadge order={o} tid={tid} />
      </span>
      <span className="flex w-full items-center gap-1 md:gap-2">
        <span className={`badge num shrink-0 rounded px-1 text-[11px] md:hidden ${WAIT_STYLE[card.color]}`}>{card.waitMinutes}′</span>
        {(o.ship_mode === 'external' || o.ship_fee > 0) && (
          <Bike aria-hidden className={`h-3.5 w-3.5 shrink-0 md:hidden ${o.ship_mode === 'external' ? 'text-danger-strong' : 'text-warning-strong'}`} />
        )}
        <StatusBadge group={card.group} />
        <span className="flex-1" />
        <b className="num text-sm font-bold md:text-[17px]" data-testid={tid('total')}>
          {formatVnd(o.total)}
        </b>
      </span>
    </button>
  );
}

function ShipBadge({ order: o, tid }: { order: Order; tid: (k: string) => string | undefined }) {
  if (o.ship_mode === 'external') {
    return (
      <span className="badge num shrink-0 rounded-md px-1.5 text-[11px] font-semibold bg-danger-soft text-danger-strong" data-testid={tid('ship-external')}>
        {externalShipBadge(o.ship_payout)}
      </span>
    );
  }
  if (o.ship_fee > 0) {
    return (
      <span className="badge num shrink-0 rounded-md px-1.5 text-[11px] bg-warning-soft text-warning-strong" data-testid={tid('ship-fee')}>
        {shipFeeLabel(o.ship_fee)} ship
      </span>
    );
  }
  return null;
}

function StatusBadge({ group }: { group: QueueCard['group'] }) {
  return group === 'serve' ? (
    <span className="badge hidden shrink-0 rounded-md bg-warning-soft text-xs text-warning-strong md:inline-flex">
      <ChefHat aria-hidden className="h-3.5 w-3.5" />
      Chờ ra món
    </span>
  ) : (
    <span className="badge hidden shrink-0 rounded-md bg-brand-soft text-xs text-brand-deep md:inline-flex">
      <Wallet aria-hidden className="h-3.5 w-3.5" />
      Chờ thanh toán
    </span>
  );
}
