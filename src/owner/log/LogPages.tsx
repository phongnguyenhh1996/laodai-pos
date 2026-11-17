import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { ACTION_GROUPS, ACTION_LABELS, DELETE_REASON_LABELS, actionLabel, describeAudit, type AuditEntry } from '@/domain/audit';
import { lineSummary } from '@/domain/cart';
import { formatVnd } from '@/domain/money';
import { hhmm } from '@/domain/time';
import type { DeleteReason } from '@/domain/types';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { PAGE_SIZE, loadLog, loadLogNames, loadOrderDetail, type LogNames, type OrderDetail } from './api';

const day = (at: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date(at)) + ' ' + hhmm(at);

/** Đồng bộ trễ ≥ 2 phút (làm lúc offline) ⇒ hiện cả thời điểm thực hiện và đồng bộ, như tin Telegram. */
function when(e: AuditEntry): string {
  const lag = Date.parse(e.synced_at) - Date.parse(e.at);
  return lag >= 2 * 60_000 ? `${day(e.at)} (đồng bộ ${day(e.synced_at)})` : day(e.at);
}

function actor(e: AuditEntry, names: LogNames): string {
  if (e.actor_kind === 'owner') return 'Chủ';
  if (e.actor_kind === 'system') return 'Hệ thống';
  return (e.staff_id && names.staff.get(e.staff_id)) || 'Nhân viên';
}

function useLog(filterKey: string, load: (after?: AuditEntry) => Promise<AuditEntry[]>) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    load()
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setMore(r.length === PAGE_SIZE);
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);
  const loadMore = async () => {
    if (!rows?.length) return;
    try {
      const next = await load(rows[rows.length - 1]);
      setRows([...rows, ...next]);
      setMore(next.length === PAGE_SIZE);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return { rows, more, error, loadMore };
}

function useNames(): LogNames | null {
  const { client } = useOwner();
  const [names, setNames] = useState<LogNames | null>(null);
  useEffect(() => {
    let alive = true;
    loadLogNames(client)
      .then((n) => alive && setNames(n))
      .catch(() => alive && setNames({ staff: new Map(), tablets: new Map(), customers: new Map() }));
    return () => {
      alive = false;
    };
  }, [client]);
  return names;
}

/** `/owner/log?type=…&staff=…&date=YYYY-MM-DD` (link trong tin Telegram dùng `?action=`). */
export function LogPage() {
  const { client } = useOwner();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? params.get('action') ?? '';
  const staffId = params.get('staff') ?? '';
  const date = params.get('date') ?? '';
  const names = useNames();
  const filterKey = `${type}|${staffId}|${date}`;
  const load = useCallback(
    (after?: AuditEntry) => loadLog(client, { type, staffId, date }, after),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, filterKey],
  );
  const { rows, more, error, loadMore } = useLog(filterKey, load);

  function set(key: 'type' | 'staff' | 'date', value: string) {
    const next = new URLSearchParams(params);
    next.delete('action');
    if (key !== 'type' && type) next.set('type', type);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const isGroup = ACTION_GROUPS.some((g) => g.id === type);
  const select = 'min-h-tap w-full rounded-xl border border-stone-300 bg-white px-3 text-lg';

  return (
    <OwnerLayout title="Nhật ký" back="/owner" testId="log-page">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select className={select} value={type} onChange={(e) => set('type', e.target.value)} data-testid="log-filter-type" aria-label="Loại">
          <option value="">Mọi loại</option>
          <optgroup label="Nhóm">
            {ACTION_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Từng loại">
            {Object.entries(ACTION_LABELS).map(([a, label]) => (
              <option key={a} value={a}>
                {label}
              </option>
            ))}
          </optgroup>
          {type && !isGroup && !ACTION_LABELS[type] && <option value={type}>{type}</option>}
        </select>
        <select className={select} value={staffId} onChange={(e) => set('staff', e.target.value)} data-testid="log-filter-staff" aria-label="Nhân viên">
          <option value="">Mọi nhân viên</option>
          {[...(names?.staff ?? new Map<string, string>())].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input type="date" className={select} value={date} onChange={(e) => set('date', e.target.value)} data-testid="log-filter-date" aria-label="Ngày" />
      </div>

      <ErrorText testId="log-error">{error}</ErrorText>
      {(!rows || !names) && !error && <Splash />}
      {rows && names && rows.length === 0 && (
        <p className="text-stone-500" data-testid="log-empty">
          Không có mục nào.
        </p>
      )}
      {rows && names && rows.length > 0 && (
        <ol className="flex flex-col divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white" data-testid="log-list">
          {rows.map((e) => (
            <LogRow key={e.id} e={e} names={names} />
          ))}
        </ol>
      )}
      {more && (
        <button type="button" className="btn border border-stone-300 bg-white" onClick={() => void loadMore()} data-testid="log-more">
          Xem thêm
        </button>
      )}
    </OwnerLayout>
  );
}

function LogRow({ e, names }: { e: AuditEntry; names: LogNames }) {
  const lines = describeAudit(e, { customer: (id) => names.customers.get(id) ?? id });
  const code = (e.after as { code?: string } | null)?.code ?? (e.before as { code?: string } | null)?.code;
  const tablet = e.tablet_profile_id ? names.tablets.get(e.tablet_profile_id) : null;
  const alert = e.action === 'order_delete' || e.action === 'seq_gap' || e.action === 'sync_rejected' || e.action === 'owner_edit_order';
  return (
    <li className="flex flex-col gap-1 px-4 py-3" data-testid="log-row" data-action={e.action} data-entity={e.entity_id ?? ''}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className={`font-semibold ${alert ? 'text-red-700' : ''}`} data-testid="log-row-title">
          {actionLabel(e.action)}
          {code && e.entity === 'order' && (
            <>
              {' '}
              <Link to={`/owner/orders/${e.entity_id}`} className="font-mono underline" data-testid="log-row-order">
                {code}
              </Link>
            </>
          )}
        </span>
        <span className="text-sm text-stone-500">{when(e)}</span>
      </p>
      <p className="text-sm text-stone-600" data-testid="log-row-actor">
        {actor(e, names)}
        {tablet ? ` – ${tablet}` : ''}
      </p>
      {lines.map((l, i) => (
        <p key={i} className="text-base" data-testid="log-row-line">
          {l}
        </p>
      ))}
    </li>
  );
}

const STATUS: Record<OrderDetail['status'], string> = { open: 'Chờ ra món', served: 'Chờ thanh toán', paid: 'Đã thanh toán', deleted: 'Đã xóa' };
const METHOD = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ' } as const;

/** `/owner/orders/:orderId`: chi tiết đơn + toàn bộ nhật ký của đơn. */
export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const { client } = useOwner();
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
  return (
    <OwnerLayout title={o ? `Đơn ${o.code}` : 'Đơn'} back="/owner/orders" testId="order-detail">
      <ErrorText testId="order-detail-error">{error ?? log.error}</ErrorText>
      {saved && (
        <p className="rounded-lg bg-green-50 px-4 py-3 text-green-800" data-testid="order-edit-saved">
          Đã lưu. Ca đã đóng (nếu có) đã được tính lại; Telegram đã được báo.
        </p>
      )}
      {o === undefined && !error && <Splash />}
      {o === null && <p className="text-stone-500">Không có đơn này.</p>}
      {o && (
        <section className="flex flex-col gap-1 rounded-xl border border-stone-200 bg-white p-4" data-testid="order-detail-info" data-status={o.status}>
          <p className="flex items-baseline justify-between">
            <b className={o.status === 'deleted' ? 'text-red-700' : ''} data-testid="order-detail-status">
              {STATUS[o.status]}
              {o.owner_edited && ' · chủ đã sửa'}
            </b>
            <b className={`text-2xl ${o.status === 'deleted' ? 'line-through' : ''}`} data-testid="order-detail-total">
              {formatVnd(o.total)}
            </b>
          </p>
          <p className="text-stone-600">
            {o.point_name} · {o.tablet_name} · {o.dine_type === 'dinein' ? 'Tại chỗ' : 'Mang về'}
            {o.label ? ` · ${o.label}` : ''}
          </p>
          {o.items.map((it, i) => (
            <p key={i} data-testid="order-detail-item">
              {lineSummary(it)} — {formatVnd((it.unit_price_snap + it.toppings_snap.reduce((s, t) => s + t.price, 0)) * it.qty)}
            </p>
          ))}
          <p className="text-sm text-stone-600" data-testid="order-detail-times">
            Tạo {day(o.created_at)} ({o.opened_by})
            {o.served_at && ` · Ra món ${hhmm(o.served_at)}`}
            {o.paid_at && ` · Thu ${hhmm(o.paid_at)} (${o.paid_by}) · ${METHOD[o.payment_method!]}`}
            {o.cash_given !== null && o.payment_method === 'cash' && ` · khách đưa ${formatVnd(o.cash_given)}`}
            {o.customer_label && ` · ${o.customer_label}`}
            {o.deleted_at && ` · Xóa ${hhmm(o.deleted_at)} – ${DELETE_REASON_LABELS[o.delete_reason as DeleteReason] ?? o.delete_reason}`}
          </p>
          <p className="flex flex-wrap gap-x-3 text-sm">
            <Link to={`/owner/shifts/${o.opened_shift_id}`} className="underline" data-testid="order-detail-opened-shift">
              Ca mở đơn
            </Link>
            {o.paid_shift_id && o.paid_shift_id !== o.opened_shift_id && (
              <Link to={`/owner/shifts/${o.paid_shift_id}`} className="underline" data-testid="order-detail-paid-shift">
                Ca thu tiền
              </Link>
            )}
          </p>
          {o.status === 'paid' && (
            <Link to={`/owner/orders/${o.id}/edit`} className="btn mt-2 flex items-center justify-center border border-amber-700 text-amber-800" data-testid="order-edit">
              Sửa đơn đã thanh toán
            </Link>
          )}
        </section>
      )}
      <h2 className="text-lg font-semibold">Nhật ký của đơn</h2>
      {log.rows && names && (
        <ol className="flex flex-col divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white" data-testid="log-list">
          {log.rows.map((e) => (
            <LogRow key={e.id} e={e} names={names} />
          ))}
        </ol>
      )}
    </OwnerLayout>
  );
}
