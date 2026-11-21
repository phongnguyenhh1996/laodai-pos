import { useEffect, useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { addCombo, addProduct, itemsSummary, stepLineQty } from '@/domain/cart';
import { customerLabel, suggestCustomers } from '@/domain/debt';
import { formatSigned, formatVnd } from '@/domain/money';
import { editDraftFrom, editPayload, editProblem, editSummary, setEditCustomer, setEditMethod, type OwnerEditDraft } from '@/domain/ownerEdit';
import { lineTotal, selectableCombos, selectableProducts, selectableToppings } from '@/domain/pricing';
import { businessDate, hhmm } from '@/domain/time';
import { DINE_LABELS, type OrderStatus, type PaymentMethod, type Product } from '@/domain/types';
import { OrderDetailPage } from './OrderDetail';
import { useOwner } from '../OwnerContext';
import { Chip, OwnerLayout } from '../OwnerLayout';
import { btn, card, IconTile, PageHead, SearchBox, SelectBox, TONE, UnderlineTabs, type Tone } from '../ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { DELETE_REASON_LABELS } from '@/domain/audit';
import { Banknote, BookUser, CalendarDays, ChevronDown, CircleAlert, HandCoins, Landmark, Minus, Plus, ReceiptText, SlidersHorizontal, Store, Users, Wallet, type LucideIcon } from 'lucide-react';
import { loadOwnerCatalog, type OwnerCatalog } from '../settings/api';
import { listOrders, loadEditCatalog, loadEditableOrder, saveOwnerEdit, type EditCatalog, type EditableOrder, type OrderListRow } from './api';

/** `/owner/orders/*` (mục 7, màn chủ số 3). */
export function OrderRoutes() {
  return (
    <Routes>
      <Route index element={<OrderList />} />
      <Route path=":orderId" element={<OrderDetailPage />} />
      <Route path=":orderId/edit" element={<OrderEditPage />} />
    </Routes>
  );
}

export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ' };
const METHOD_SHORT: Record<PaymentMethod, string> = { cash: 'TM', transfer: 'CK', debt: 'Nợ' };
const STATUS_LABEL: Record<OrderStatus, string> = { open: 'Chờ ra món', served: 'Chờ thanh toán', paid: 'Đã thu', deleted: 'Đã xóa' };

function useCatalog(): OwnerCatalog | null {
  const { client } = useOwner();
  const [cat, setCat] = useState<OwnerCatalog | null>(null);
  useEffect(() => {
    let alive = true;
    loadOwnerCatalog(client)
      .then((c) => alive && setCat(c))
      .catch(() => alive && setCat({ menus: [], points: [], products: [], toppings: [], combos: [], staff: [], staffDetails: [], profiles: [] }));
    return () => {
      alive = false;
    };
  }, [client]);
  return cat;
}

/** Tab trạng thái: "Chờ" gồm chờ ra món + chờ thanh toán. */
type StatusTab = '' | 'paid' | 'waiting' | 'deleted';
const TAB_STATUSES: Record<Exclude<StatusTab, ''>, OrderStatus[]> = { paid: ['paid'], waiting: ['open', 'served'], deleted: ['deleted'] };
const STATUS_TONE: Record<OrderStatus, Tone> = { open: 'amber', served: 'blue', paid: 'green', deleted: 'red' };

function tabOf(raw: string | null): StatusTab {
  if (raw === 'paid' || raw === 'deleted' || raw === 'waiting') return raw;
  if (raw === 'open' || raw === 'served') return 'waiting';
  return '';
}

function dayLabel(date: string, today: string): string {
  if (!date) return 'Mọi ngày';
  if (date === today) return 'Hôm nay';
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

function matches(o: OrderListRow, q: string): boolean {
  const hay = [o.code, o.label, o.opened_by, o.paid_by, o.customer_label, ...o.items.map((i) => i.name_snap)].filter(Boolean).join(' ').toLocaleLowerCase('vi');
  return hay.includes(q);
}

/**
 * `/owner/orders?date=YYYY-MM-DD&point=…&staff=…&method=…&status=paid|waiting|deleted` (không có `date` ⇒ hôm nay; `date=` ⇒ mọi ngày).
 * Figma R22 / T21: tìm kiếm, lọc ngày + điểm (nút ⚙ mở thêm lọc nhân viên / hình thức), tab trạng thái có số đếm, thẻ đơn.
 */
function OrderList() {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const [params, setParams] = useSearchParams();
  const today = businessDate(new Date());
  const date = params.has('date') ? params.get('date') || '' : today;
  const pointId = params.get('point') ?? '';
  const staffId = params.get('staff') ?? '';
  const method = (params.get('method') ?? '') as PaymentMethod | '';
  const tab = tabOf(params.get('status'));
  const cat = useCatalog();
  const [rows, setRows] = useState<OrderListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [more, setMore] = useState(!!(staffId || method));
  const key = `${date}|${pointId}|${staffId}|${method}`;

  useEffect(() => {
    let alive = true;
    setRows(null);
    listOrders(client, { date: date || null, pointId: pointId || null, staffId: staffId || null, method: method || null, status: null })
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  function set(k: 'date' | 'point' | 'staff' | 'method' | 'status', v: string) {
    const next = new URLSearchParams(params);
    if (k === 'date') next.set('date', v);
    else if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  }

  const needle = q.trim().toLocaleLowerCase('vi');
  const found = rows && needle ? rows.filter((o) => matches(o, needle)) : rows;
  const count = (t: StatusTab) => (found ? (t ? found.filter((o) => TAB_STATUSES[t].includes(o.status)).length : found.length) : undefined);
  const shown = found && tab ? found.filter((o) => TAB_STATUSES[tab].includes(o.status)) : found;
  const paid = rows?.filter((o) => o.status === 'paid') ?? [];
  const sum = paid.reduce((s, o) => s + o.total, 0);
  const subtitle = rows ? (
    <span data-testid="orders-summary">
      {dayLabel(date, today)} · <span data-testid="orders-count">{rows.length} đơn</span> · đã thu <span data-testid="orders-sum">{formatVnd(sum)}</span>
    </span>
  ) : (
    dayLabel(date, today)
  );

  return (
    <OwnerLayout title={isTablet ? 'Danh sách đơn' : 'Đơn'} subtitle={isTablet ? subtitle : undefined} back="/owner" wide testId="orders-page">
      <div className="flex flex-col gap-3.5 md:gap-5">
        {!isTablet && <PageHead title="Danh sách đơn" subtitle={subtitle} />}
        <SearchBox value={q} onChange={setQ} placeholder="Tìm mã đơn, món, nhân viên…" testId="orders-search" />
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <label className="relative flex h-[38px] min-w-0 items-center gap-2 rounded-xl border border-line bg-white px-3 focus-within:border-brand">
            <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-[#6d6d6d]" />
            <span className="num flex-1 truncate text-[13px] font-medium leading-4">{dayLabel(date, '')}</span>
            <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-[#6d6d6d]" />
            <input
              type="date"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={date}
              onChange={(e) => set('date', e.target.value)}
              data-testid="orders-filter-date"
              aria-label="Ngày"
            />
          </label>
          <SelectBox icon={Store} value={pointId} onChange={(e) => set('point', e.target.value)} data-testid="orders-filter-point" aria-label="Điểm bán">
            <option value="">Mọi điểm</option>
            {cat?.points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectBox>
          <button
            type="button"
            aria-label="Lọc thêm"
            aria-expanded={more}
            onClick={() => setMore((m) => !m)}
            className={`flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border ${more || staffId || method ? 'border-brand bg-[#ffeee7] text-[#c2380a]' : 'border-line bg-white text-[#111]'}`}
            data-testid="orders-filter-more"
          >
            <SlidersHorizontal aria-hidden className="h-[18px] w-[18px]" />
          </button>
        </div>
        {more && (
          <div className="grid grid-cols-2 gap-2" data-testid="orders-filter-extra">
            <SelectBox icon={Users} value={staffId} onChange={(e) => set('staff', e.target.value)} data-testid="orders-filter-staff" aria-label="Nhân viên">
              <option value="">Mọi nhân viên</option>
              {cat?.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectBox>
            <SelectBox icon={Wallet} value={method} onChange={(e) => set('method', e.target.value)} data-testid="orders-filter-method" aria-label="Hình thức">
              <option value="">Mọi hình thức</option>
              {(['cash', 'transfer', 'debt'] as const).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </SelectBox>
          </div>
        )}
        <UnderlineTabs
          testIdPrefix="orders-tab"
          value={tab}
          onChange={(t) => set('status', t)}
          tabs={[
            { key: '', label: 'Tất cả', count: count('') },
            { key: 'paid', label: 'Đã thu', count: count('paid') },
            { key: 'waiting', label: 'Chờ', count: count('waiting') },
            { key: 'deleted', label: 'Đã xóa', count: count('deleted') },
          ]}
        />

        <ErrorText testId="orders-error">{error}</ErrorText>
        {!rows && !error && <Splash />}
        {shown?.length === 0 && (
          <p className="py-6 text-center text-sm text-[#888]" data-testid="orders-empty">
            Không có đơn nào.
          </p>
        )}
        {shown && shown.length > 0 && (
          <ul className="grid grid-cols-1 gap-3.5 md:grid-cols-2 md:gap-x-5 md:gap-y-4" data-testid="orders-list">
            {shown.map((o) => (
              <OrderRow key={o.id} o={o} />
            ))}
          </ul>
        )}
      </div>
    </OwnerLayout>
  );
}

function OrderRow({ o }: { o: OrderListRow }) {
  const deleted = o.status === 'deleted';
  const who = [
    `Mở: ${o.opened_by}`,
    o.paid_by && `Thu: ${o.paid_by}`,
    o.customer_label && `Khách: ${o.customer_label}`,
    deleted && o.delete_reason && `Lý do: ${DELETE_REASON_LABELS[o.delete_reason].toLocaleLowerCase('vi')}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li data-testid="orders-row" data-id={o.id} data-status={o.status} data-method={o.payment_method ?? ''}>
      <Link to={`/owner/orders/${o.id}`} className={`${card} h-full gap-2.5 p-3.5 transition-colors duration-fast hover:border-line-strong`}>
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <IconTile icon={ReceiptText} />
            <span className="flex min-w-0 flex-col gap-px">
              <span className="flex items-center gap-1.5">
                <b className={`text-[15px] leading-[19px] ${deleted ? 'line-through' : ''}`}>#{o.code}</b>
                {o.owner_edited && (
                  <Chip className={`${TONE.amber} !px-2 !py-0.5 !text-[11px]`} testId="orders-row-edited">
                    chủ đã sửa
                  </Chip>
                )}
              </span>
              <span className="num truncate text-xs leading-[15px] text-[#888]">{[hhmm(o.at), o.point_name, o.label].filter(Boolean).join(' · ')}</span>
            </span>
          </span>
          <Chip className={TONE[STATUS_TONE[o.status]]}>{STATUS_LABEL[o.status]}</Chip>
        </span>
        <span className="text-[13px] leading-4">{itemsSummary(o.items)}</span>
        <span className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2.5">
          <span className="min-w-0 truncate text-xs leading-[15px] text-[#888]" data-testid="orders-row-who">
            {who}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {o.payment_method && !deleted && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold leading-[14px] ${TONE.gray}`}>{METHOD_SHORT[o.payment_method]}</span>}
            <b className={`num text-[15px] leading-[19px] ${deleted ? 'text-[#888]' : ''}`} data-testid="orders-row-total">
              {formatVnd(o.total)}
            </b>
          </span>
        </span>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------- sửa đơn đã thanh toán

/** `/owner/orders/:orderId/edit`: sửa món / hình thức / khách nợ (mục 4.7, Figma R24 / T23). */
function OrderEditPage() {
  const { orderId = '' } = useParams();
  const { client } = useOwner();
  const [order, setOrder] = useState<EditableOrder | null | undefined>(undefined);
  const [cat, setCat] = useState<EditCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadEditableOrder(client, orderId)
      .then(async (o) => {
        if (!alive) return;
        setOrder(o);
        if (o) {
          const c = await loadEditCatalog(client, o.menu_id);
          if (alive) setCat(c);
        }
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client, orderId]);

  if (order && order.status === 'paid' && cat) return <EditForm order={order} cat={cat} />;
  return (
    <OwnerLayout title={order ? `Sửa đơn #${order.code}` : 'Sửa đơn'} back={`/owner/orders/${orderId}`} wide testId="order-edit">
      <ErrorText testId="edit-load-error">{error}</ErrorText>
      {(order === undefined || (order && !cat)) && !error && <Splash />}
      {order === null && <p className="text-[#888]">Không có đơn này.</p>}
      {order && order.status !== 'paid' && (
        <p className="text-[#888]" data-testid="edit-not-paid">
          Chỉ sửa được đơn đã thanh toán.
        </p>
      )}
    </OwnerLayout>
  );
}

const label = 'text-xs font-semibold uppercase leading-[15px] tracking-normal text-[#888]';
const METHOD_ICON: Record<PaymentMethod, LucideIcon> = { cash: Banknote, transfer: Landmark, debt: HandCoins };

function EditForm({ order, cat }: { order: EditableOrder; cat: EditCatalog }) {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OwnerEditDraft>(() => editDraftFrom(order));
  const [picking, setPicking] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = editProblem(draft, order);
  const sum = editSummary(draft, order);
  const products = selectableProducts(cat.products, order.menu_id);
  const combos = selectableCombos(cat.combos, cat.products, cat.toppings, order.menu_id);
  const status = problem ?? (sum.diff ? `Chênh lệch ${formatSigned(sum.diff)}` : 'Đã sửa');

  function update(fn: (d: OwnerEditDraft) => OwnerEditDraft) {
    try {
      setDraft(fn);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function save() {
    const payload = editPayload(draft, order);
    if (!payload || problem) return;
    setBusy(true);
    setError(null);
    try {
      await saveOwnerEdit(client, order.id, payload);
      navigate(`/owner/orders/${order.id}`, { replace: true, state: { saved: true } });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const saveBtn = (
    <button
      type="button"
      className={`inline-flex h-[45px] items-center justify-center rounded-xl px-4 text-[15px] font-semibold leading-[19px] transition-colors duration-fast ${
        problem || busy ? 'cursor-not-allowed bg-[#efefef] text-[#a3a3a3]' : 'bg-brand text-white hover:bg-brand-strong'
      } ${isTablet ? '' : 'flex-1'}`}
      disabled={!!problem || busy}
      onClick={() => void save()}
      data-testid="edit-save"
    >
      {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
    </button>
  );
  const statusText = (
    <span data-testid="edit-problem" data-ok={problem ? undefined : 'true'}>
      {status}
    </span>
  );

  const items = (
    <section className="flex flex-col gap-3.5 md:gap-4">
      <h2 className={label}>Món</h2>
      {draft.items.length === 0 && <p className="text-sm text-[#888]">Chưa có món.</p>}
      {draft.items.map((it) => (
        <div key={it.id} className="flex items-center justify-between gap-2.5 rounded-2xl border border-line bg-white p-3.5" data-testid={`edit-line-${it.id}`}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-semibold leading-[19px]">
              {it.name_snap}
              {it.toppings_snap.length > 0 && ` (${it.toppings_snap.map((t) => t.name).join(', ')})`}
            </span>
            <span className="num text-[13px] font-semibold leading-4 text-brand">{formatVnd(lineTotal(it))}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-line bg-white hover:bg-[#f8f8f8]"
              onClick={() => update((d) => ({ ...d, items: stepLineQty(d.items, it.id, -1) }))}
              data-testid={`edit-line-${it.id}-minus`}
              aria-label="Bớt"
            >
              <Minus aria-hidden className="h-4 w-4" />
            </button>
            <b className="num min-w-[7px] text-center text-base leading-5" data-testid={`edit-line-${it.id}-qty`}>
              {it.qty}
            </b>
            <button
              type="button"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-brand text-white hover:bg-brand-strong"
              onClick={() => update((d) => ({ ...d, items: stepLineQty(d.items, it.id, 1) }))}
              data-testid={`edit-line-${it.id}-plus`}
              aria-label="Thêm"
            >
              <Plus aria-hidden className="h-4 w-4" />
            </button>
          </span>
        </div>
      ))}

      <details className="group flex flex-col" data-testid="edit-add">
        <summary
          className="flex h-[46px] cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-[#f9b79b] bg-[#ffeee7] text-sm font-semibold text-[#c2380a] hover:bg-[#ffe2d5] [&::-webkit-details-marker]:hidden"
          data-testid="edit-add-open"
        >
          <Plus aria-hidden className="h-[18px] w-[18px]" />
          Thêm món (giá hiện hành)
        </summary>
        <div className={`${card} mt-2.5 gap-2.5 p-3.5`}>
          <div className="grid grid-cols-2 gap-2">
            {combos.map((c) => (
              <button
                key={c.id}
                type="button"
                className={choice(false)}
                onClick={() => update((d) => ({ ...d, items: addCombo(d.items, uuidv7(), c, cat.products, cat.toppings, order.menu_id) }))}
                data-testid={`edit-add-combo-${c.id}`}
              >
                {c.name}
              </button>
            ))}
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={picking?.id === p.id}
                className={choice(picking?.id === p.id)}
                onClick={() => setPicking(picking?.id === p.id ? null : p)}
                data-testid={`edit-add-product-${p.id}`}
              >
                {p.name} · <span className="num">{formatVnd(p.price)}</span>
              </button>
            ))}
          </div>
          {picking && (
            <ToppingPicker
              key={picking.id}
              product={picking}
              toppings={selectableToppings(cat.toppings, order.menu_id)}
              onAdd={(tops) => {
                update((d) => ({ ...d, items: addProduct(d.items, uuidv7(), picking, tops, order.menu_id) }));
                setPicking(null);
              }}
            />
          )}
        </div>
      </details>
    </section>
  );

  const payment = (
    <section className="flex flex-col gap-3.5 md:gap-4">
      <h2 className={label}>Hình thức thanh toán</h2>
      <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Hình thức">
        {(['cash', 'transfer', 'debt'] as const).map((m) => {
          const on = draft.payment_method === m;
          const Icon = METHOD_ICON[m];
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => update((d) => setEditMethod(d, m))}
              className={`flex h-[77px] flex-col items-center justify-center gap-2 rounded-[14px] px-2 text-[13px] leading-4 transition-colors duration-fast ${
                on ? 'border-[1.5px] border-brand bg-[#ffeee7] font-semibold text-[#c2380a]' : 'border border-line bg-white font-medium text-[#111] hover:bg-[#f8f8f8]'
              }`}
              data-testid={`edit-method-${m}`}
            >
              <Icon aria-hidden className={`h-[22px] w-[22px] ${on ? '' : 'text-[#6d6d6d]'}`} />
              {METHOD_LABEL[m]}
            </button>
          );
        })}
      </div>
      {draft.payment_method === 'debt' && <CustomerPicker customers={cat.customers} chosenId={draft.customer_id} onPick={(id) => update((d) => setEditCustomer(d, id))} />}
      <div className={`${card} divide-y divide-line px-4 py-2`}>
        {order.ship_fee > 0 && (
          <p className="flex items-center justify-between py-[9px] text-sm leading-[18px]">
            <span className="text-[#6d6d6d]">Phí ship (giữ nguyên)</span>
            <b className="num font-semibold" data-testid="edit-ship-fee">
              {formatVnd(order.ship_fee)}
            </b>
          </p>
        )}
        <p className="flex items-center justify-between py-[9px] text-sm leading-[18px]">
          <span className="text-[#6d6d6d]">Tổng trước</span>
          <b className="num font-semibold" data-testid="edit-total-before">
            {formatVnd(sum.before)}
          </b>
        </p>
        <p className="flex items-center justify-between py-[9px] text-sm leading-[18px]">
          <span className="text-[#6d6d6d]">Tổng sau</span>
          <b className="num font-semibold" data-testid="edit-total-after">
            {formatVnd(sum.after)}
          </b>
        </p>
        <p className="flex items-center justify-between py-[9px] text-sm leading-[18px]">
          <span className="font-semibold">Chênh lệch</span>
          <b className={`num text-base leading-5 ${sum.diff < 0 ? 'text-[#b91c1c]' : sum.diff > 0 ? 'text-[#15803d]' : ''}`} data-testid="edit-total-diff">
            {formatSigned(sum.diff)}
          </b>
        </p>
      </div>
    </section>
  );

  return (
    <OwnerLayout
      title={`Sửa đơn #${order.code}`}
      subtitle={
        isTablet ? (
          <>
            {statusText} · tổng <span className="num">{formatVnd(sum.after)}</span>
          </>
        ) : undefined
      }
      actions={isTablet ? saveBtn : undefined}
      bottomBar={
        isTablet ? undefined : (
          <>
            <span className="flex w-[97px] shrink-0 flex-col gap-0.5">
              <span className="truncate text-xs leading-[15px] text-[#888]">{statusText}</span>
              <b className="num text-lg leading-[23px]">{formatVnd(sum.after)}</b>
            </span>
            {saveBtn}
          </>
        )
      }
      back={`/owner/orders/${order.id}`}
      wide
      testId="order-edit"
    >
      <div className="flex flex-col gap-3.5 md:gap-5" data-testid="edit-form">
        {!isTablet && (
          <p className="flex flex-wrap gap-2">
            <Chip className={TONE.gray}>
              <Store aria-hidden className="h-3.5 w-3.5" />
              {order.point_name}
            </Chip>
            <Chip className={TONE.gray}>{order.tablet_name}</Chip>
            <Chip className={TONE.gray}>{DINE_LABELS[order.dine_type]}</Chip>
          </p>
        )}
        {order.closed_shift_ids.length > 0 && (
          <p className="flex items-start gap-2.5 rounded-xl bg-[#fef5e1] px-3.5 py-3 text-[13px] leading-[19px] text-[#a16207]" data-testid="edit-recalc-note">
            <CircleAlert aria-hidden className="h-[18px] w-[18px] shrink-0" />
            <span>Ca của đơn này đã đóng: lưu xong sẽ tính lại đối soát và đánh dấu “đã điều chỉnh”. Telegram được báo ngay.</span>
          </p>
        )}
        <ErrorText testId="edit-error">{error}</ErrorText>
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:items-start md:gap-5">
          {items}
          {payment}
        </div>
      </div>
    </OwnerLayout>
  );
}

const choice = (on: boolean) =>
  `min-h-11 rounded-xl px-3 py-2 text-left text-[13px] font-medium leading-4 transition-colors duration-fast ${
    on ? 'border-[1.5px] border-brand bg-[#ffeee7] text-[#c2380a]' : 'border border-line bg-white hover:bg-[#f8f8f8]'
  }`;

function ToppingPicker({ product, toppings, onAdd }: { product: Product; toppings: ReturnType<typeof selectableToppings>; onAdd: (t: typeof toppings) => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const price = product.price + toppings.filter((t) => chosen.includes(t.id)).reduce((s, t) => s + t.price, 0);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-[#f8f8f8] p-3" data-testid="edit-topping-picker">
      <p className="text-sm font-semibold">{product.name} + topping</p>
      <div className="grid grid-cols-2 gap-2">
        {toppings.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={chosen.includes(t.id)}
            onClick={() => setChosen((c) => (c.includes(t.id) ? c.filter((x) => x !== t.id) : [...c, t.id]))}
            className={choice(chosen.includes(t.id))}
            data-testid={`edit-topping-${t.id}`}
          >
            {t.name} <span className="num">+{formatVnd(t.price)}</span>
          </button>
        ))}
      </div>
      <button type="button" className={btn('dark')} onClick={() => onAdd(toppings.filter((t) => chosen.includes(t.id)))} data-testid="edit-add-confirm">
        Thêm · <span className="num">{formatVnd(price)}</span>
      </button>
    </div>
  );
}

function CustomerPicker({ customers, chosenId, onPick }: { customers: EditCatalog['customers']; chosenId: string | null; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const chosen = useMemo(() => customers.find((c) => c.id === chosenId) ?? null, [customers, chosenId]);
  if (chosen)
    return (
      <p className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-white px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold" data-testid="edit-customer-chosen">
          <BookUser aria-hidden className="h-4 w-4 text-[#6d6d6d]" />
          {customerLabel(chosen)}
        </span>
        <button type="button" className={btn('outline', 'min-h-9 px-3 text-[13px]')} onClick={() => onPick(null)} data-testid="edit-customer-clear">
          Đổi khách
        </button>
      </p>
    );
  const list = suggestCustomers(customers, q);
  return (
    <div className="flex flex-col gap-2">
      <SearchBox value={q} onChange={setQ} placeholder="Khách nợ (gõ tên / mô tả)" testId="edit-customer-search" />
      {list.map((c) => (
        <button key={c.id} type="button" className={choice(false)} onClick={() => onPick(c.id)} data-testid={`edit-customer-${c.id}`}>
          {customerLabel(c)}
        </button>
      ))}
    </div>
  );
}
