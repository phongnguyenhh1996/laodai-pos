import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banknote, ChefHat, ChevronLeft, Minus, Plus, Save, ShoppingBag, Trash2, UtensilsCrossed, Wallet } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import {
  addCombo,
  addProduct,
  canSwitchPoint,
  draftChanged,
  draftTotal,
  lineSummary,
  newDraft,
  setDineType,
  stepLineQty,
  switchPoint,
  type CartDraft,
} from '@/domain/cart';
import { DELETE_REASON_LABELS } from '@/domain/audit';
import { tabletPoints } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { lineTotal, selectableToppings } from '@/domain/pricing';
import type { Combo, DeleteReason, Order, Point, Product, Topping } from '@/domain/types';
import { localDb } from '@/lib/localdb';
import { Splash, errorMessage } from '@/app/ui';
import { createOrder, deleteOrder, getOpenOrder, payOrder, serveOrder, updateOrder } from '@/sync';
import { MenuBoard } from './MenuBoard';
import { Notice, Sheet, useTablet } from './parts';
import type { QueueFlash } from './QueueScreen';

const DELETE_REASONS = (['mistake', 'customer_left', 'customer_changed', 'other'] as const).map((id) => ({ id, label: DELETE_REASON_LABELS[id] }));

type Dialog = { kind: 'toppings'; product: Product } | { kind: 'delete' } | { kind: 'discard' } | null;

/**
 * Tạo / sửa đơn (mục 4.2): tab điểm bán, combo (1 chạm), món → topping, Tại chỗ / Mang về, nhãn.
 * Nhân viên thấy giá nhưng không có ô nào để sửa giá hay giảm giá.
 * Bản nháp chỉ ghi xuống máy (và outbox) khi bấm Lưu / Đã ra món / Thanh toán.
 */
export function OrderScreen() {
  const { orderId } = useParams();
  const { catalog, lastPointId, setLastPointId } = useTablet();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Order | null>(null);
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const points = catalog ? tabletPoints(catalog.profile, catalog.points) : [];

  // Nạp đơn (sửa) hoặc dựng bản nháp mới ở điểm bán gần nhất.
  useEffect(() => {
    let alive = true;
    if (orderId) {
      void getOpenOrder(localDb, orderId).then((o) => {
        if (!alive) return;
        if (!o) return navigate('/', { replace: true }); // đã thanh toán / đã xóa / không có
        setSaved(o);
        setDraft({ point_id: o.point_id, dine_type: o.dine_type, dine_type_touched: true, label: o.label ?? '', items: o.items });
      });
    } else if (!draft && points.length > 0) {
      setDraft(newDraft(points.find((p) => p.id === lastPointId) ?? points[0]));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, points.length]);

  // Chủ vừa bỏ điểm bán đang chọn khỏi hồ sơ tablet (danh mục mới đồng bộ về) ⇒ đơn chưa có món về điểm đầu tiên.
  const pointGone = !!draft && points.length > 0 && !points.some((p) => p.id === draft.point_id);
  useEffect(() => {
    if (pointGone && draft && draft.items.length === 0) setDraft(switchPoint(draft, points, points[0]));
  }, [pointGone, draft, points]);

  if (!catalog) return <Splash />;
  if (points.length === 0) {
    return (
      <main className="p-6">
        <p data-testid="menu-no-points" className="text-ink-subtle">
          Hồ sơ tablet chưa có điểm bán nào. Nhờ chủ chọn điểm bán trong Cài đặt.
        </p>
      </main>
    );
  }
  if (!draft) return <Splash />;

  const cat = catalog;
  const d = draft;
  const point = cat.points.find((p) => p.id === d.point_id);
  const menuId = point?.menu_id ?? '';
  const total = draftTotal(d);
  const dirty = saved ? draftChanged(d, saved) : d.items.length > 0 || d.label.trim() !== '';
  const empty = d.items.length === 0;

  function edit(fn: (d: CartDraft) => CartDraft) {
    setError(null);
    try {
      setDraft(fn(d));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function onSelectPoint(p: Point) {
    edit((x) => switchPoint(x, cat.points, p));
  }

  function onCombo(c: Combo) {
    edit((x) => ({ ...x, items: addCombo(x.items, uuidv7(), c, cat.products, cat.toppings, menuId) }));
  }

  function onProduct(p: Product) {
    if (selectableToppings(cat.toppings, menuId).length === 0) {
      edit((x) => ({ ...x, items: addProduct(x.items, uuidv7(), p, [], menuId) }));
    } else {
      setDialog({ kind: 'toppings', product: p });
    }
  }

  function addWithToppings(p: Product, toppingIds: string[]) {
    const tops = toppingIds.map((id) => cat.toppings.find((t) => t.id === id)).filter((t): t is Topping => !!t);
    edit((x) => ({ ...x, items: addProduct(x.items, uuidv7(), p, tops, menuId) }));
    setDialog(null);
  }

  /** Chạy một thao tác ghi (chặn bấm đúp: không bao giờ tạo hai đơn). */
  async function run(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** Ghi bản nháp: đơn mới ⇒ create_order; đơn cũ có thay đổi ⇒ update_order. */
  async function persist(): Promise<Order> {
    setLastPointId(d.point_id);
    const fields = { point_id: d.point_id, dine_type: d.dine_type, label: d.label, items: d.items };
    let o: Order;
    if (!saved) {
      // Từ đây đơn đã có trên máy (setSaved bên dưới): bước sau lỗi rồi bấm lại là sửa chứ không tạo đơn thứ hai.
      o = await createOrder(localDb, fields);
    } else if (draftChanged(d, saved)) {
      o = await updateOrder(localDb, saved.id, fields);
    } else {
      o = saved;
    }
    setSaved(o);
    return o;
  }

  const done = (flash?: string) => navigate('/', { replace: true, state: flash ? ({ flash } satisfies QueueFlash) : null });

  const save = () => run(async () => {
    await persist();
    done();
  });
  const serve = () => run(async () => {
    const o = await persist();
    if (o.status === 'open') await serveOrder(localDb, o.id);
    done();
  });
  const pay = () => run(async () => {
    const o = await persist();
    navigate(`/order/${o.id}/pay`);
  });
  /** Thu đủ tiền mặt ngay từ màn đơn: combo + thanh toán đủ tiền chỉ mất 3 chạm từ hàng đợi. */
  const payExact = () => run(async () => {
    const o = await persist();
    await payOrder(localDb, o.id, { method: 'cash', cash_given: o.total });
    done(`Đã thu ${formatVnd(o.total)} – đơn ${o.code}`);
  });
  const remove = (reason: DeleteReason) => run(async () => {
    if (!saved) return;
    await deleteOrder(localDb, saved.id, reason);
    setDialog(null);
    done(`Đã xóa đơn ${saved.code}`);
  });

  function back() {
    if (dirty) setDialog({ kind: 'discard' });
    else navigate('/');
  }

  return (
    <main data-testid="order-screen" data-point={d.point_id} className="flex h-full flex-col gap-4 overflow-y-auto p-4 md:flex-row md:overflow-hidden">
      <div className="md:min-w-0 md:flex-1 md:overflow-y-auto md:pr-1">
        <MenuBoard
          catalog={cat}
          pointId={d.point_id}
          onSelectPoint={onSelectPoint}
          canSelectPoint={(p) => canSwitchPoint(d, cat.points, p)}
          onCombo={onCombo}
          onProduct={onProduct}
        />
      </div>

      <aside data-testid="cart" className="card flex w-full shrink-0 flex-col gap-3 p-4 md:w-[380px] lg:w-[420px]">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-secondary pl-3" onClick={back} data-testid="order-back">
            <ChevronLeft aria-hidden className="h-5 w-5" />
            Hàng đợi
          </button>
          <span className="font-mono text-2xl font-bold tracking-wider" data-testid="order-code">
            {saved?.code ?? 'Đơn mới'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-surface-sunken p-1" role="group" aria-label="Tại chỗ / Mang về">
          {(['dinein', 'takeaway'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={d.dine_type === t}
              onClick={() => edit((x) => setDineType(x, t))}
              className="btn min-h-[52px] text-ink-muted hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-card"
              data-testid={`order-dine-${t}`}
            >
              {t === 'dinein' ? <UtensilsCrossed aria-hidden className="h-5 w-5" /> : <ShoppingBag aria-hidden className="h-5 w-5" />}
              {t === 'dinein' ? 'Tại chỗ' : 'Mang về'}
            </button>
          ))}
        </div>

        <input
          className="input"
          aria-label="Nhãn / số bàn"
          placeholder="Nhãn / số bàn (tùy chọn)"
          maxLength={40}
          value={d.label}
          onChange={(e) => edit((x) => ({ ...x, label: e.target.value }))}
          data-testid="order-label"
        />

        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" data-testid="cart-lines">
          {empty && (
            <li className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong py-8 text-center text-ink-subtle">
              <ShoppingBag aria-hidden className="h-8 w-8 opacity-60" />
              Bấm combo hoặc món để thêm
            </li>
          )}
          {d.items.map((it) => (
            <li key={it.id} data-testid={`cart-line-${it.id}`} data-product={it.product_id} className="flex items-center gap-2 rounded-xl border border-line bg-surface-muted p-2 pl-3">
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-medium leading-tight">{lineSummary({ ...it, qty: 1 }).replace(/^1× /, '')}</span>
                <span className="num text-base text-ink-subtle" data-testid={`cart-line-${it.id}-total`}>
                  {formatVnd(lineTotal(it))}
                </span>
              </span>
              <button type="button" className="btn btn-secondary px-0" onClick={() => edit((x) => ({ ...x, items: stepLineQty(x.items, it.id, -1) }))} aria-label="Bớt" data-testid={`cart-line-${it.id}-minus`}>
                <Minus aria-hidden className="h-6 w-6" />
              </button>
              <span className="num w-8 text-center text-xl font-bold" data-testid={`cart-line-${it.id}-qty`}>
                {it.qty}
              </span>
              <button type="button" className="btn btn-secondary px-0" onClick={() => edit((x) => ({ ...x, items: stepLineQty(x.items, it.id, 1) }))} aria-label="Thêm" data-testid={`cart-line-${it.id}-plus`}>
                <Plus aria-hidden className="h-6 w-6" />
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-baseline justify-between border-t border-dashed border-line-strong pt-3">
          <span className="text-xl font-medium text-ink-muted">Tổng</span>
          <span className="num text-3xl font-bold text-ink" data-testid="order-total">
            {formatVnd(total)}
          </span>
        </div>

        <Notice testId="order-error" tone="error">
          {error}
        </Notice>

        <button type="button" className="btn btn-success min-h-[64px] text-xl" disabled={empty || busy} onClick={() => void payExact()} data-testid="order-pay-exact">
          <Banknote aria-hidden className="h-6 w-6" />
          Thu đủ tiền mặt {formatVnd(total)}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-primary" disabled={empty || busy} onClick={() => void pay()} data-testid="order-pay">
            <Wallet aria-hidden className="h-5 w-5" />
            Thanh toán…
          </button>
          {saved?.status === 'served' ? (
            <span />
          ) : (
            <button type="button" className="btn btn-dark" disabled={empty || busy} onClick={() => void serve()} data-testid="order-serve">
              <ChefHat aria-hidden className="h-5 w-5" />
              Đã ra món
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={empty || busy} onClick={() => void save()} data-testid="order-save">
            <Save aria-hidden className="h-5 w-5" />
            Lưu
          </button>
          {saved && (
            <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={() => setDialog({ kind: 'delete' })} data-testid="order-delete">
              <Trash2 aria-hidden className="h-5 w-5" />
              Xóa đơn
            </button>
          )}
        </div>
      </aside>

      {dialog?.kind === 'toppings' && (
        <ToppingSheet
          product={dialog.product}
          toppings={selectableToppings(cat.toppings, menuId)}
          onAdd={(ids) => addWithToppings(dialog.product, ids)}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'delete' && (
        <Sheet testId="delete-sheet" title={`Xóa đơn ${saved?.code ?? ''}? Chọn lý do`}>
          <div className="grid grid-cols-2 gap-3">
            {DELETE_REASONS.map((r) => (
              <button key={r.id} type="button" className="btn btn-danger-outline min-h-[72px] bg-danger-soft" disabled={busy} onClick={() => void remove(r.id)} data-testid={`delete-reason-${r.id}`}>
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)} data-testid="delete-cancel">
            Không xóa
          </button>
        </Sheet>
      )}

      {dialog?.kind === 'discard' && (
        <Sheet testId="discard-sheet" title="Bỏ các thay đổi chưa lưu?">
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)} data-testid="discard-no">
              Ở lại
            </button>
            <button type="button" className="btn btn-danger" onClick={() => navigate('/')} data-testid="discard-yes">
              Bỏ thay đổi
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

function ToppingSheet({
  product,
  toppings,
  onAdd,
  onCancel,
}: {
  product: Product;
  toppings: Topping[];
  onAdd: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const price = product.price + toppings.filter((t) => picked.includes(t.id)).reduce((s, t) => s + t.price, 0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Sheet testId="topping-sheet" title={product.name}>
      <div className="grid grid-cols-2 gap-3">
        {toppings.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={picked.includes(t.id)}
            onClick={() => toggle(t.id)}
            className="btn btn-choice min-h-[72px] flex-col items-start justify-center gap-0 text-left"
            data-testid={`topping-option-${t.id}`}
          >
            <span>{t.name}</span>
            <span className="num text-base font-medium opacity-80">+{formatVnd(t.price)}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-secondary" onClick={onCancel} data-testid="topping-cancel">
          Hủy
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onAdd(picked)} data-testid="topping-add">
          Thêm · {formatVnd(price)}
        </button>
      </div>
    </Sheet>
  );
}
