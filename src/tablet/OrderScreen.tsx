import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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

export const DELETE_REASONS: Array<{ id: DeleteReason; label: string }> = [
  { id: 'mistake', label: 'Bấm nhầm' },
  { id: 'customer_left', label: 'Khách bỏ về' },
  { id: 'customer_changed', label: 'Khách đổi ý' },
  { id: 'other', label: 'Khác' },
];

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
        <p data-testid="menu-no-points" className="text-stone-500">
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
    <main data-testid="order-screen" data-point={d.point_id} className="flex h-full gap-4 p-4">
      <div className="min-w-0 flex-1 overflow-y-auto pr-1">
        <MenuBoard
          catalog={cat}
          pointId={d.point_id}
          onSelectPoint={onSelectPoint}
          canSelectPoint={(p) => canSwitchPoint(d, cat.points, p)}
          onCombo={onCombo}
          onProduct={onProduct}
        />
      </div>

      <aside data-testid="cart" className="flex w-[420px] shrink-0 flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn border border-stone-300 bg-white" onClick={back} data-testid="order-back">
            ‹ Hàng đợi
          </button>
          <span className="font-mono text-2xl font-bold tracking-wider" data-testid="order-code">
            {saved?.code ?? 'Đơn mới'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tại chỗ / Mang về">
          {(['dinein', 'takeaway'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={d.dine_type === t}
              onClick={() => edit((x) => setDineType(x, t))}
              className={`btn border ${d.dine_type === t ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white'}`}
              data-testid={`order-dine-${t}`}
            >
              {t === 'dinein' ? 'Tại chỗ' : 'Mang về'}
            </button>
          ))}
        </div>

        <input
          className="min-h-tap rounded-xl border border-stone-300 px-4 text-lg outline-none focus:border-amber-600"
          placeholder="Nhãn / số bàn (tùy chọn)"
          maxLength={40}
          value={d.label}
          onChange={(e) => edit((x) => ({ ...x, label: e.target.value }))}
          data-testid="order-label"
        />

        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" data-testid="cart-lines">
          {empty && <li className="py-6 text-center text-stone-400">Bấm combo hoặc món để thêm</li>}
          {d.items.map((it) => (
            <li key={it.id} data-testid={`cart-line-${it.id}`} data-product={it.product_id} className="flex items-center gap-2 rounded-xl bg-stone-50 p-2">
              <span className="min-w-0 flex-1">
                <span className="block text-lg leading-tight">{lineSummary({ ...it, qty: 1 }).replace(/^1× /, '')}</span>
                <span className="text-base text-stone-500" data-testid={`cart-line-${it.id}-total`}>
                  {formatVnd(lineTotal(it))}
                </span>
              </span>
              <button type="button" className="btn border border-stone-300 bg-white px-0 text-2xl" onClick={() => edit((x) => ({ ...x, items: stepLineQty(x.items, it.id, -1) }))} aria-label="Bớt" data-testid={`cart-line-${it.id}-minus`}>
                −
              </button>
              <span className="w-8 text-center text-xl font-bold" data-testid={`cart-line-${it.id}-qty`}>
                {it.qty}
              </span>
              <button type="button" className="btn border border-stone-300 bg-white px-0 text-2xl" onClick={() => edit((x) => ({ ...x, items: stepLineQty(x.items, it.id, 1) }))} aria-label="Thêm" data-testid={`cart-line-${it.id}-plus`}>
                +
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-baseline justify-between border-t border-stone-200 pt-3">
          <span className="text-xl text-stone-600">Tổng</span>
          <span className="text-3xl font-bold" data-testid="order-total">
            {formatVnd(total)}
          </span>
        </div>

        <Notice testId="order-error" tone="error">
          {error}
        </Notice>

        <button type="button" className="btn min-h-[64px] bg-emerald-700 text-xl text-white" disabled={empty || busy} onClick={() => void payExact()} data-testid="order-pay-exact">
          Thu đủ tiền mặt {formatVnd(total)}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn bg-amber-700 text-white" disabled={empty || busy} onClick={() => void pay()} data-testid="order-pay">
            Thanh toán…
          </button>
          {saved?.status === 'served' ? (
            <span />
          ) : (
            <button type="button" className="btn bg-stone-800 text-white" disabled={empty || busy} onClick={() => void serve()} data-testid="order-serve">
              Đã ra món
            </button>
          )}
          <button type="button" className="btn border border-stone-300 bg-white" disabled={empty || busy} onClick={() => void save()} data-testid="order-save">
            Lưu
          </button>
          {saved && (
            <button type="button" className="btn border border-red-300 bg-white text-red-700" disabled={busy} onClick={() => setDialog({ kind: 'delete' })} data-testid="order-delete">
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
              <button key={r.id} type="button" className="btn min-h-[72px] border border-red-300 bg-red-50 text-red-800" disabled={busy} onClick={() => void remove(r.id)} data-testid={`delete-reason-${r.id}`}>
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn border border-stone-300 bg-white" onClick={() => setDialog(null)} data-testid="delete-cancel">
            Không xóa
          </button>
        </Sheet>
      )}

      {dialog?.kind === 'discard' && (
        <Sheet testId="discard-sheet" title="Bỏ các thay đổi chưa lưu?">
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn border border-stone-300 bg-white" onClick={() => setDialog(null)} data-testid="discard-no">
              Ở lại
            </button>
            <button type="button" className="btn bg-red-700 text-white" onClick={() => navigate('/')} data-testid="discard-yes">
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
            className={`btn flex min-h-[64px] flex-col items-start justify-center border text-left ${picked.includes(t.id) ? 'border-amber-700 bg-amber-700 text-white' : 'border-stone-300 bg-white'}`}
            data-testid={`topping-option-${t.id}`}
          >
            <span>{t.name}</span>
            <span className="text-base font-normal">+{formatVnd(t.price)}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn border border-stone-300 bg-white" onClick={onCancel} data-testid="topping-cancel">
          Hủy
        </button>
        <button type="button" className="btn bg-amber-700 text-white" onClick={() => onAdd(picked)} data-testid="topping-add">
          Thêm · {formatVnd(price)}
        </button>
      </div>
    </Sheet>
  );
}
