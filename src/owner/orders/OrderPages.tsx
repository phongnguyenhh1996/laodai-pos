import { useEffect, useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { addCombo, addProduct, itemsSummary, lineSummary, stepLineQty } from '@/domain/cart';
import { customerLabel, suggestCustomers } from '@/domain/debt';
import { formatSigned, formatVnd } from '@/domain/money';
import { editDraftFrom, editPayload, editProblem, editSummary, setEditCustomer, setEditMethod, type OwnerEditDraft } from '@/domain/ownerEdit';
import { lineTotal, selectableCombos, selectableProducts, selectableToppings } from '@/domain/pricing';
import { businessDate, hhmm } from '@/domain/time';
import type { OrderStatus, PaymentMethod, Product } from '@/domain/types';
import { OrderDetailPage } from '../log/LogPages';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
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

const select = 'input px-3';

function useCatalog(): OwnerCatalog | null {
  const { client } = useOwner();
  const [cat, setCat] = useState<OwnerCatalog | null>(null);
  useEffect(() => {
    let alive = true;
    loadOwnerCatalog(client)
      .then((c) => alive && setCat(c))
      .catch(() => alive && setCat({ menus: [], points: [], products: [], toppings: [], combos: [], staff: [], profiles: [] }));
    return () => {
      alive = false;
    };
  }, [client]);
  return cat;
}

/** `/owner/orders?date=YYYY-MM-DD&point=…&staff=…&method=…&status=…` (không có `date` ⇒ hôm nay; `date=` ⇒ mọi ngày). */
function OrderList() {
  const { client } = useOwner();
  const [params, setParams] = useSearchParams();
  const today = businessDate(new Date());
  const date = params.has('date') ? params.get('date') || '' : today;
  const pointId = params.get('point') ?? '';
  const staffId = params.get('staff') ?? '';
  const method = (params.get('method') ?? '') as PaymentMethod | '';
  const status = (params.get('status') ?? '') as OrderStatus | '';
  const cat = useCatalog();
  const [rows, setRows] = useState<OrderListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${date}|${pointId}|${staffId}|${method}|${status}`;

  useEffect(() => {
    let alive = true;
    setRows(null);
    listOrders(client, { date: date || null, pointId: pointId || null, staffId: staffId || null, method: method || null, status: status || null })
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

  const paid = rows?.filter((o) => o.status === 'paid') ?? [];
  const sum = paid.reduce((s, o) => s + o.total, 0);

  return (
    <OwnerLayout title="Đơn" back="/owner" testId="orders-page">
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className={`${select} col-span-2`} value={date} onChange={(e) => set('date', e.target.value)} data-testid="orders-filter-date" aria-label="Ngày" />
        <select className={select} value={pointId} onChange={(e) => set('point', e.target.value)} data-testid="orders-filter-point" aria-label="Điểm bán">
          <option value="">Mọi điểm</option>
          {cat?.points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className={select} value={staffId} onChange={(e) => set('staff', e.target.value)} data-testid="orders-filter-staff" aria-label="Nhân viên">
          <option value="">Mọi nhân viên</option>
          {cat?.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className={select} value={method} onChange={(e) => set('method', e.target.value)} data-testid="orders-filter-method" aria-label="Hình thức">
          <option value="">Mọi hình thức</option>
          {(['cash', 'transfer', 'debt'] as const).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        <select className={select} value={status} onChange={(e) => set('status', e.target.value)} data-testid="orders-filter-status" aria-label="Trạng thái">
          <option value="">Mọi trạng thái</option>
          {(['open', 'served', 'paid', 'deleted'] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <ErrorText testId="orders-error">{error}</ErrorText>
      {!rows && !error && <Splash />}
      {rows && (
        <p className="flex justify-between text-ink-muted" data-testid="orders-summary">
          <span data-testid="orders-count">{rows.length} đơn</span>
          <span>
            Đã thu {paid.length}: <b data-testid="orders-sum">{formatVnd(sum)}</b>
          </span>
        </p>
      )}
      {rows?.length === 0 && (
        <p className="text-ink-subtle" data-testid="orders-empty">
          Không có đơn nào.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-line overflow-hidden card" data-testid="orders-list">
          {rows.map((o) => (
            <OrderRow key={o.id} o={o} />
          ))}
        </ul>
      )}
    </OwnerLayout>
  );
}

function OrderRow({ o }: { o: OrderListRow }) {
  const deleted = o.status === 'deleted';
  return (
    <li data-testid="orders-row" data-id={o.id} data-status={o.status} data-method={o.payment_method ?? ''}>
      <Link to={`/owner/orders/${o.id}`} className="flex flex-col gap-0.5 px-4 py-3 active:bg-surface-muted">
        <span className="flex items-baseline justify-between gap-2">
          <span>
            <b className="font-mono">{o.code}</b> · {hhmm(o.at)} · <span className={deleted ? 'text-danger-strong' : ''}>{STATUS_LABEL[o.status]}</span>
            {o.payment_method && ` · ${METHOD_SHORT[o.payment_method]}`}
            {o.owner_edited && (
              <span className="ml-2 rounded bg-warning-soft px-1.5 text-sm text-warning-strong" data-testid="orders-row-edited">
                chủ đã sửa
              </span>
            )}
          </span>
          <b className={deleted ? 'line-through' : ''} data-testid="orders-row-total">
            {formatVnd(o.total)}
          </b>
        </span>
        <span className="text-sm text-ink-muted">{itemsSummary(o.items)}</span>
        <span className="text-sm text-ink-subtle" data-testid="orders-row-who">
          {o.point_name} · Mở: {o.opened_by}
          {o.paid_by ? ` · Thu: ${o.paid_by}` : ''}
          {o.customer_label ? ` · ${o.customer_label}` : ''}
        </span>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------- sửa đơn đã thanh toán

/** `/owner/orders/:orderId/edit`: sửa món / hình thức / khách nợ (mục 4.7). */
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

  return (
    <OwnerLayout title={order ? `Sửa đơn ${order.code}` : 'Sửa đơn'} back={`/owner/orders/${orderId}`} testId="order-edit">
      <ErrorText testId="edit-load-error">{error}</ErrorText>
      {(order === undefined || (order && !cat)) && !error && <Splash />}
      {order === null && <p className="text-ink-subtle">Không có đơn này.</p>}
      {order && order.status !== 'paid' && (
        <p className="text-ink-subtle" data-testid="edit-not-paid">
          Chỉ sửa được đơn đã thanh toán.
        </p>
      )}
      {order && order.status === 'paid' && cat && <EditForm order={order} cat={cat} />}
    </OwnerLayout>
  );
}

function EditForm({ order, cat }: { order: EditableOrder; cat: EditCatalog }) {
  const { client } = useOwner();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OwnerEditDraft>(() => editDraftFrom(order));
  const [picking, setPicking] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = editProblem(draft, order);
  const sum = editSummary(draft, order);
  const products = selectableProducts(cat.products, order.menu_id);
  const combos = selectableCombos(cat.combos, cat.products, cat.toppings, order.menu_id);

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

  return (
    <div className="flex flex-col gap-4" data-testid="edit-form">
      <p className="text-ink-muted">
        {order.point_name} · {order.tablet_name} · {order.dine_type === 'dinein' ? 'Tại chỗ' : 'Mang về'}
      </p>
      {order.closed_shift_ids.length > 0 && (
        <p className="rounded-lg bg-warning-soft px-4 py-3 text-warning-strong" data-testid="edit-recalc-note">
          Ca của đơn này đã đóng: lưu xong sẽ <b>tính lại đối soát</b> và đánh dấu “đã điều chỉnh”. Telegram được báo ngay.
        </p>
      )}

      <section className="flex flex-col gap-2 card p-4">
        <h2 className="text-lg font-semibold">Món</h2>
        {draft.items.length === 0 && <p className="text-ink-subtle">Chưa có món.</p>}
        {draft.items.map((it) => (
          <div key={it.id} className="flex items-center justify-between gap-2" data-testid={`edit-line-${it.id}`}>
            <span className="min-w-0 flex-1">
              {lineSummary(it)}
              <span className="block text-sm text-ink-subtle">{formatVnd(lineTotal(it))}</span>
            </span>
            <button type="button" className="btn w-14 btn-secondary text-2xl" onClick={() => update((d) => ({ ...d, items: stepLineQty(d.items, it.id, -1) }))} data-testid={`edit-line-${it.id}-minus`} aria-label="Bớt">
              −
            </button>
            <b className="w-8 text-center" data-testid={`edit-line-${it.id}-qty`}>
              {it.qty}
            </b>
            <button type="button" className="btn w-14 btn-secondary text-2xl" onClick={() => update((d) => ({ ...d, items: stepLineQty(d.items, it.id, 1) }))} data-testid={`edit-line-${it.id}-plus`} aria-label="Thêm">
              +
            </button>
          </div>
        ))}

        <details className="mt-2" data-testid="edit-add">
          <summary className="btn flex cursor-pointer items-center border border-dashed border-line-strong bg-surface-muted" data-testid="edit-add-open">
            + Thêm món (giá hiện hành)
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              {combos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn-brand-outline justify-start text-left text-base"
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
                  className="btn btn-choice justify-start text-left text-base"
                  onClick={() => setPicking(picking?.id === p.id ? null : p)}
                  data-testid={`edit-add-product-${p.id}`}
                >
                  {p.name} · {formatVnd(p.price)}
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

      <section className="flex flex-col gap-2 card p-4">
        <h2 className="text-lg font-semibold">Hình thức thanh toán</h2>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Hình thức">
          {(['cash', 'transfer', 'debt'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={draft.payment_method === m}
              onClick={() => update((d) => setEditMethod(d, m))}
              className="btn btn-segment"
              data-testid={`edit-method-${m}`}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {draft.payment_method === 'debt' && (
          <CustomerPicker customers={cat.customers} chosenId={draft.customer_id} onPick={(id) => update((d) => setEditCustomer(d, id))} />
        )}
      </section>

      <section className="flex flex-col gap-1 card p-4">
        <p className="flex justify-between">
          <span className="text-ink-muted">Tổng trước</span>
          <span data-testid="edit-total-before">{formatVnd(sum.before)}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-ink-muted">Tổng sau</span>
          <b className="text-xl" data-testid="edit-total-after">
            {formatVnd(sum.after)}
          </b>
        </p>
        <p className="flex justify-between">
          <span className="text-ink-muted">Chênh lệch</span>
          <span data-testid="edit-total-diff">{formatSigned(sum.diff)}</span>
        </p>
      </section>

      <ErrorText testId="edit-error">{error}</ErrorText>
      {problem && (
        <p className="text-ink-subtle" data-testid="edit-problem">
          {problem}
        </p>
      )}
      <button type="button" className="btn btn-primary" disabled={!!problem || busy} onClick={() => void save()} data-testid="edit-save">
        {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
      </button>
    </div>
  );
}

function ToppingPicker({ product, toppings, onAdd }: { product: Product; toppings: ReturnType<typeof selectableToppings>; onAdd: (t: typeof toppings) => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const price = product.price + toppings.filter((t) => chosen.includes(t.id)).reduce((s, t) => s + t.price, 0);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3" data-testid="edit-topping-picker">
      <p className="font-medium">{product.name} + topping</p>
      <div className="grid grid-cols-2 gap-2">
        {toppings.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={chosen.includes(t.id)}
            onClick={() => setChosen((c) => (c.includes(t.id) ? c.filter((x) => x !== t.id) : [...c, t.id]))}
            className="btn btn-choice text-base"
            data-testid={`edit-topping-${t.id}`}
          >
            {t.name} +{formatVnd(t.price)}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-dark" onClick={() => onAdd(toppings.filter((t) => chosen.includes(t.id)))} data-testid="edit-add-confirm">
        Thêm · {formatVnd(price)}
      </button>
    </div>
  );
}

function CustomerPicker({ customers, chosenId, onPick }: { customers: EditCatalog['customers']; chosenId: string | null; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const chosen = useMemo(() => customers.find((c) => c.id === chosenId) ?? null, [customers, chosenId]);
  if (chosen)
    return (
      <p className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2">
        <span data-testid="edit-customer-chosen">{customerLabel(chosen)}</span>
        <button type="button" className="btn btn-secondary" onClick={() => onPick(null)} data-testid="edit-customer-clear">
          Đổi khách
        </button>
      </p>
    );
  const list = suggestCustomers(customers, q);
  return (
    <div className="flex flex-col gap-2">
      <TextField label="Khách nợ (gõ tên / mô tả)" value={q} onChange={(e) => setQ(e.target.value)} data-testid="edit-customer-search" />
      {list.map((c) => (
        <button key={c.id} type="button" className="btn btn-secondary text-left" onClick={() => onPick(c.id)} data-testid={`edit-customer-${c.id}`}>
          {customerLabel(c)}
        </button>
      ))}
    </div>
  );
}
