import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Banknote, ChefHat, CircleCheck, Clock, HandCoins, Landmark, Pencil, Trash2, Users, type LucideIcon } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { DELETE_REASON_LABELS, actionLabel, describeAudit, type AuditEntry } from '@/domain/audit';
import { formatVnd } from '@/domain/money';
import { businessDate, hhmm } from '@/domain/time';
import { DINE_LABELS, type DeleteReason, type OrderStatus, type PaymentMethod } from '@/domain/types';
import { AuditFlags, actor, day, useLog, useNames, when } from '../log/LogPages';
import { loadLog, loadOrderDetail, loadOrderPrints, type LogNames, type OrderDetail, type OrderPrintRow } from '../log/api';
import { actionVisual } from '../log/visual';
import { useOwner } from '../OwnerContext';
import { Chip, OwnerLayout } from '../OwnerLayout';
import { RemotePrint, shownStatus } from '../print/RemotePrint';
import { KV, Section, TONE, btn, card, type Tone } from '../ui';

const STATUS: Record<OrderStatus, [string, Tone, LucideIcon]> = {
  open: ['Chờ ra món', 'amber', ChefHat],
  served: ['Chờ thanh toán', 'blue', Clock],
  paid: ['Đã thanh toán', 'green', CircleCheck],
  deleted: ['Đã xóa', 'red', Trash2],
};
const METHOD: Record<PaymentMethod, [string, Tone, LucideIcon]> = {
  cash: ['Tiền mặt', 'green', Banknote],
  transfer: ['Chuyển khoản', 'blue', Landmark],
  debt: ['Ghi nợ', 'amber', HandCoins],
};
const PRINT_KIND = {
  kitchen: 'Phiếu bếp',
  bill: 'Bill',
  test: 'In thử',
} as const;
const PRINT_SOURCE = {
  auto: 'tự in',
  staff: 'nhân viên in lại',
  owner: 'chủ gửi',
} as const;
const PRINT_STATUS = {
  pending: 'đang chờ',
  claimed: 'đang in',
  printed: 'đã in',
  failed: 'lỗi',
  expired: 'hết hạn',
} as const;

/** Giờ ngắn nếu cùng ngày hôm nay, không thì kèm ngày. */
function at(iso: string): string {
  return businessDate(new Date(iso)) === businessDate(new Date()) ? hhmm(iso) : day(iso);
}

/** `/owner/orders/:orderId`: chi tiết đơn, in lại từ xa, nhật ký của đơn (Figma R23 / T22). */
export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const saved = (useLocation().state as { saved?: boolean } | null)?.saved === true;
  const names = useNames();
  const [order, setOrder] = useState<OrderDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadOrderDetail(client, orderId)
      .then((o) => alive && setOrder(o))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client, orderId]);
  const load = useCallback((after?: AuditEntry) => loadLog(client, { entityId: orderId }, after), [client, orderId]);
  const log = useLog(orderId, load);

  const o = order;
  const meta = o ? [o.point_name, o.tablet_name, DINE_LABELS[o.dine_type], o.label].filter(Boolean).join(' · ') : undefined;

  const logCard = (
    <Section title="Nhật ký của đơn" testId="order-log">
      {log.rows && names ? (
        <ol className="flex flex-col" data-testid="log-list">
          {log.rows.map((e, i) => (
            <TimelineRow key={e.id} e={e} names={names} last={i === log.rows!.length - 1} />
          ))}
        </ol>
      ) : (
        <Splash />
      )}
    </Section>
  );

  return (
    <OwnerLayout title={o ? `Đơn #${o.code}` : 'Đơn'} subtitle={isTablet ? meta : undefined} back="/owner/orders" tabBar wide testId="order-detail">
      <ErrorText testId="order-detail-error">{error ?? log.error}</ErrorText>
      {saved && (
        <p className="rounded-xl bg-[#e8f7ee] px-4 py-3 text-sm font-medium text-[#15803d]" data-testid="order-edit-saved">
          Đã lưu. Ca đã đóng (nếu có) đã được tính lại; Telegram đã được báo.
        </p>
      )}
      {o === undefined && !error && <Splash />}
      {o === null && <p className="text-[#888]">Không có đơn này.</p>}
      {o && (
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:items-start md:gap-5">
          <div className="flex flex-col gap-3.5 md:gap-4">
            <InfoCard o={o} meta={meta!} />
            <TimesCard o={o} />
          </div>
          <div className="flex flex-col gap-3.5 md:gap-4">
            {o.status !== 'deleted' && <PrintCard o={o} />}
            {logCard}
          </div>
        </div>
      )}
    </OwnerLayout>
  );
}

function InfoCard({ o, meta }: { o: OrderDetail; meta: string }) {
  const [label, tone, Icon] = STATUS[o.status];
  const deleted = o.status === 'deleted';
  return (
    <section className={`${card} gap-3 p-4`} data-testid="order-detail-info" data-status={o.status}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <b className={`text-[22px] leading-7 ${deleted ? 'line-through' : ''}`}>#{o.code}</b>
          <span className="truncate text-xs leading-[15px] text-[#888]">{meta}</span>
        </div>
        <Chip className={TONE[tone]}>
          <Icon aria-hidden className="h-3.5 w-3.5" />
          <span data-testid="order-detail-status">{label}</span>
        </Chip>
      </div>
      {o.address && (
        <p className="text-[13px] text-[#6d6d6d]" data-testid="order-detail-address">
          Giao đến: {o.address}
        </p>
      )}
      <ul className="flex flex-col border-t border-line pt-1">
        {o.items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2.5 py-2.5" data-testid="order-detail-item">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f8f8f8] text-xs font-bold text-[#6d6d6d]">{it.qty}×</span>
              <span className="text-sm font-medium leading-[18px]">
                {it.name_snap}
                {it.toppings_snap.length > 0 && ` (${it.toppings_snap.map((t) => t.name).join(', ')})`}
              </span>
            </span>
            <span className="num shrink-0 text-sm font-semibold leading-[18px]">
              {formatVnd((it.unit_price_snap + it.toppings_snap.reduce((s, t) => s + t.price, 0)) * it.qty)}
            </span>
          </li>
        ))}
        {o.ship_fee > 0 && (
          <li className="flex items-center justify-between gap-2.5 py-2.5 text-sm text-[#6d6d6d]" data-testid="order-detail-ship-fee">
            <span className="font-medium">{o.ship_mode === 'external' ? 'Phụ thu' : 'Phí ship'}</span>
            <span className="num shrink-0 font-semibold">{formatVnd(o.ship_fee)}</span>
          </li>
        )}
        {o.ship_mode === 'external' && (
          <li className="flex items-center justify-between gap-2.5 py-2.5 text-sm text-[#b91c1c]" data-testid="order-detail-ship-payout">
            <span className="font-medium">Trả shipper (tiền két, không tính vào tổng)</span>
            <span className="num shrink-0 font-semibold">{formatVnd(o.ship_payout ?? 0)}</span>
          </li>
        )}
      </ul>
      <p className="flex items-center justify-between rounded-xl bg-[#f8f8f8] px-3.5 py-3">
        <span className="text-sm font-semibold leading-[18px]">Tổng</span>
        <b className={`num text-xl leading-[25px] ${deleted ? 'text-[#888] line-through' : ''}`} data-testid="order-detail-total">
          {formatVnd(o.total)}
        </b>
      </p>
      {(o.payment_method || o.owner_edited || o.customer_label) && (
        <p className="flex flex-wrap items-center gap-2">
          {o.payment_method &&
            (() => {
              const [m, t, MIcon] = METHOD[o.payment_method];
              return (
                <Chip className={TONE[t]} testId="order-detail-method">
                  <MIcon aria-hidden className="h-3.5 w-3.5" />
                  {m}
                </Chip>
              );
            })()}
          {o.cash_given !== null && o.payment_method === 'cash' && <Chip className={`num ${TONE.gray}`}>Khách đưa {formatVnd(o.cash_given)}</Chip>}
          {o.customer_label && <Chip className={TONE.gray}>{o.customer_label}</Chip>}
          {o.owner_edited && (
            <Chip className={TONE.amber} testId="order-detail-edited">
              <Pencil aria-hidden className="h-3.5 w-3.5" />
              chủ đã sửa
            </Chip>
          )}
        </p>
      )}
    </section>
  );
}

function TimesCard({ o }: { o: OrderDetail }) {
  const twoShifts = o.paid_shift_id && o.paid_shift_id !== o.opened_shift_id;
  return (
    <Section title="Thời gian" testId="order-detail-times">
      <KV label="Tạo đơn">
        {day(o.created_at)} · {o.opened_by}
      </KV>
      {o.served_at && <KV label="Ra món">{at(o.served_at)}</KV>}
      {o.paid_at && (
        <KV label="Thu tiền">
          {at(o.paid_at)} · {o.paid_by}
        </KV>
      )}
      {o.deleted_at && (
        <KV label="Xóa đơn">
          {at(o.deleted_at)} · {DELETE_REASON_LABELS[o.delete_reason as DeleteReason] ?? o.delete_reason}
        </KV>
      )}
      <div className="grid auto-cols-fr grid-flow-col gap-2.5">
        <Link to={`/owner/shifts/${o.opened_shift_id}`} className={btn('outline', 'min-h-[46px]')} data-testid="order-detail-opened-shift">
          <Users aria-hidden className="h-4 w-4" />
          Ca mở đơn
        </Link>
        {twoShifts && (
          <Link to={`/owner/shifts/${o.paid_shift_id}`} className={btn('outline', 'min-h-[46px]')} data-testid="order-detail-paid-shift">
            <Users aria-hidden className="h-4 w-4" />
            Ca thu tiền
          </Link>
        )}
        {o.status === 'paid' && (
          <Link to={`/owner/orders/${o.id}/edit`} className={btn('soft')} data-testid="order-edit">
            <Pencil aria-hidden className="h-4 w-4" />
            Sửa đơn
          </Link>
        )}
      </div>
    </Section>
  );
}

/** In lại từ xa (SPEC 12.6). Dòng phụ = lần in gần nhất. Bill: chỉ khi đã thanh toán (bản in lại giống hệt bản gốc). */
function PrintCard({ o }: { o: OrderDetail }) {
  const { client } = useOwner();
  const [rows, setRows] = useState<OrderPrintRow[] | null>(null);
  const reload = useCallback(() => {
    loadOrderPrints(client, o.id)
      .then(setRows)
      .catch(() => setRows([]));
  }, [client, o.id]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);
  const last = rows?.[0];
  const subtitle = last
    ? [PRINT_KIND[last.kind], PRINT_SOURCE[last.source], last.tablet_profiles?.name, day(last.created_at), PRINT_STATUS[shownStatus(last)] + (last.error ? ` (${last.error})` : '')]
        .filter(Boolean)
        .join(' · ')
    : 'Chưa in lần nào';
  return (
    <Section title="In" subtitle={<span data-testid="order-print-last">{subtitle}</span>} testId="order-print">
      {o.status === 'paid' && <RemotePrint client={client} kind="bill" orderId={o.id} defaultProfileId={o.tablet_profile_id} label="In lại bill" testId="reprint-bill" />}
      <RemotePrint client={client} kind="kitchen" orderId={o.id} defaultProfileId={o.tablet_profile_id} label="Phiếu bếp" variant="outline" testId="reprint-kitchen" />
    </Section>
  );
}

function TimelineRow({ e, names, last }: { e: AuditEntry; names: LogNames; last: boolean }) {
  const lines = describeAudit(e, {
    customer: (id) => names.customers.get(id) ?? id,
  });
  const tablet = e.tablet_profile_id ? names.tablets.get(e.tablet_profile_id) : null;
  const v = actionVisual(e.action);
  const tone = e.action === 'order_create' ? 'gray' : v.tone;
  return (
    <li className="flex gap-3" data-testid="log-row" data-action={e.action} data-entity={e.entity_id ?? ''}>
      <span className="flex w-[30px] shrink-0 flex-col items-center">
        <span aria-hidden className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ${TONE[tone]}`}>
          <v.icon className="h-[15px] w-[15px]" />
        </span>
        {!last && <span aria-hidden className="w-0.5 flex-1 bg-line" />}
      </span>
      <span className={`flex min-w-0 flex-1 flex-col gap-0.5 ${last ? '' : 'pb-[22px]'}`}>
        <span className="flex items-baseline justify-between gap-2">
          <b className="text-sm font-semibold leading-[18px]" data-testid="log-row-title">
            {actionLabel(e.action)}
          </b>
          <span className="num shrink-0 text-xs leading-[15px] text-[#888]">{Date.parse(e.synced_at) - Date.parse(e.at) >= 2 * 60_000 ? when(e) : at(e.at)}</span>
        </span>
        <span className="text-xs leading-[15px] text-[#6d6d6d]" data-testid="log-row-actor">
          {actor(e, names)}
          {tablet ? ` – ${tablet}` : ''}
        </span>
        {lines.map((l, i) => (
          <span key={i} className="text-xs leading-[15px] text-[#6d6d6d]" data-testid="log-row-line">
            {l}
          </span>
        ))}
        <AuditFlags e={e} />
      </span>
    </li>
  );
}
