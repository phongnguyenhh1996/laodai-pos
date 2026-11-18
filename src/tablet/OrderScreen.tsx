import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftRight, Banknote, Bike, ChefHat, ChevronLeft, MapPin, Minus, Plus, Save, ShoppingBag, Trash2, UtensilsCrossed, Wallet, X } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import {
  addCombo,
  addProduct,
  canSwitchPoint,
  draftAddress,
  draftChanged,
  draftTotal,
  lineSummary,
  needsAddress,
  newDraft,
  replaceWithCombo,
  replaceWithProduct,
  setDineType,
  stepLineQty,
  switchPoint,
  type CartDraft,
} from '@/domain/cart';
import { DELETE_REASON_LABELS } from '@/domain/audit';
import { tabletPoints } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { lineTotal, selectableToppings } from '@/domain/pricing';
import { DINE_LABELS, type Combo, type DeleteReason, type DineType, type Order, type Point, type Product, type Topping } from '@/domain/types';
import { pos } from '@/lib/pos';
import { Splash, errorMessage } from '@/app/ui';
import { MenuBoard } from './MenuBoard';
import { Notice, Sheet, useTablet } from './parts';
import type { QueueFlash } from './QueueScreen';

const DINE_TYPES: ReadonlyArray<{ id: DineType; Icon: typeof ShoppingBag }> = [
  { id: 'dinein', Icon: UtensilsCrossed },
  { id: 'takeaway', Icon: ShoppingBag },
  { id: 'delivery', Icon: Bike },
];

const DELETE_REASONS = (['mistake', 'customer_left', 'customer_changed', 'other'] as const).map((id) => ({ id, label: DELETE_REASON_LABELS[id] }));

/** Chờ ngần này sau lần sửa cuối mới tự lưu (gõ nhãn, bấm +/− liên tục chỉ ra một update_order). */
const AUTOSAVE_MS = 800;

type Dialog = { kind: 'toppings'; product: Product; initial: string[] } | { kind: 'delete' } | { kind: 'discard' } | null;

/**
 * Tạo / sửa đơn (mục 4.2): tab điểm bán, combo (1 chạm), món → topping, Tại chỗ / Mang về / Ship (+ địa chỉ), nhãn.
 * Nhân viên thấy giá nhưng không có ô nào để sửa giá hay giảm giá.
 * Đơn mới chỉ ghi lên server khi bấm Tạo đơn / Đã ra món / Thanh toán.
 * Đơn đã lưu thì tự lưu mỗi khi sửa (gom các chạm liên tiếp thành một update_order).
 * Máy khác sửa / thanh toán / xóa cùng đơn: đơn trên màn này cập nhật theo (nếu chưa sửa dở) hoặc về hàng đợi.
 */
export function OrderScreen() {
  const { orderId } = useParams();
  const { catalog, orders, lastPointId, setLastPointId } = useTablet();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Order | null>(null);
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** Dòng đang chọn để đổi món: bấm món / combo kế tiếp sẽ thay dòng này thay vì thêm mới. */
  const [swapId, setSwapId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Đang gõ địa chỉ: chưa tự lưu (mỗi lần đổi địa chỉ đơn ship là một tin Telegram), lưu khi rời ô. */
  const [typingAddress, setTypingAddress] = useState(false);
  const busyRef = useRef(false);

  // Các lần ghi (tự lưu và nút bấm) chạy nối tiếp, luôn đọc bản nháp / đơn mới nhất qua ref.
  const savedRef = useRef<Order | null>(null);
  const draftRef = useRef<CartDraft | null>(null);
  savedRef.current = saved;
  draftRef.current = draft;
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  /** Id của đơn mới, cố định cho tới khi tạo xong: bấm lại sau lỗi mạng không tạo đơn thứ hai. */
  const newIdRef = useRef(uuidv7());

  /** Ghi bản nháp: đơn mới ⇒ create_order; đơn cũ có thay đổi ⇒ update_order. */
  async function persist(): Promise<Order> {
    const x = draftRef.current!;
    const s = savedRef.current;
    setLastPointId(x.point_id);
    const fields = { point_id: x.point_id, dine_type: x.dine_type, label: x.label, address: draftAddress(x), items: x.items };
    let o: Order;
    if (!s) {
      // Từ đây đơn đã có trên server (savedRef bên dưới): bước sau lỗi rồi bấm lại là sửa chứ không tạo đơn thứ hai.
      o = await pos.createOrder({ id: newIdRef.current, ...fields });
    } else if (draftChanged(x, s)) {
      o = await pos.updateOrder(s.id, fields);
    } else {
      return s;
    }
    savedRef.current = o;
    setSaved(o);
    return o;
  }

  function flush(): Promise<Order> {
    const p = queueRef.current.then(persist);
    queueRef.current = p.catch(() => undefined);
    return p;
  }

  /** Đơn đã lưu, còn món và có thay đổi ⇒ ghi ngay (không bao giờ tạo đơn mới). */
  function flushAuto(): Promise<unknown> {
    const s = savedRef.current;
    const x = draftRef.current;
    if (!s || !x || x.items.length === 0 || needsAddress(x) || !draftChanged(x, s)) return queueRef.current;
    return flush();
  }

  const autoPending = !!saved && !!draft && draft.items.length > 0 && !needsAddress(draft) && draftChanged(draft, saved);
  useEffect(() => {
    if (!autoPending || typingAddress) return;
    const t = setTimeout(() => {
      flushAuto().catch((e) => setError(errorMessage(e)));
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPending, draft, typingAddress]);

  // Tablet tắt màn / chuyển app giữa chừng: ghi luôn phần đang chờ.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushAuto().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const points = catalog ? tabletPoints(catalog.profile, catalog.points) : [];

  /** Bản mới nhất của đơn đang sửa trên server (cập nhật realtime). */
  const remote = (saved ?? orderId) ? orders.find((o) => o.id === (saved?.id ?? orderId)) ?? null : null;

  // Nạp đơn (sửa) hoặc dựng bản nháp mới ở điểm bán gần nhất.
  useEffect(() => {
    if (orderId) {
      if (!remote) return void navigate('/', { replace: true }); // đã thanh toán / đã xóa / không có
      adopt(remote);
    } else if (!draft && points.length > 0) {
      setDraft(newDraft(points.find((p) => p.id === lastPointId) ?? points[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, points.length]);

  // Máy khác vừa đổi đơn này. Đang sửa dở / đang lưu ⇒ giữ bản trên màn (lần lưu tới ghi đè);
  // chưa sửa gì ⇒ hiện bản mới. Đơn bị thanh toán / xóa ở máy khác ⇒ về hàng đợi.
  useEffect(() => {
    const s = savedRef.current;
    if (!s || busyRef.current) return;
    if (!remote) {
      navigate('/', { replace: true, state: { flash: `Đơn ${s.code} đã được thanh toán hoặc xóa ở máy khác` } satisfies QueueFlash });
      return;
    }
    if (remote === s) return;
    const x = draftRef.current;
    if (x && !draftChanged(x, s)) adopt(remote);
    else setSaved(remote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);

  function adopt(o: Order) {
    savedRef.current = o;
    setSaved(o);
    setDraft({
      point_id: o.point_id,
      dine_type: o.dine_type,
      dine_type_touched: true,
      label: o.label ?? '',
      address: o.address ?? '',
      items: o.items,
    });
  }

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
          Quầy này chưa có điểm bán nào. Nhờ chủ chọn điểm bán trong Cài đặt.
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
  const dirty = saved ? draftChanged(d, saved) : d.items.length > 0 || d.label.trim() !== '' || d.address.trim() !== '';
  const empty = d.items.length === 0;
  /** Đơn ship chưa nhập địa chỉ: chưa lưu / ra món / thanh toán được. */
  const noAddress = needsAddress(d);
  const blocked = empty || noAddress || busy;
  // Dòng đang chọn đã bị bớt hết / đổi đi ⇒ coi như không chọn.
  const swapLine = swapId ? d.items.find((it) => it.id === swapId) ?? null : null;

  function edit(fn: (d: CartDraft) => CartDraft) {
    setError(null);
    try {
      setDraft(fn(d));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function onSelectPoint(p: Point) {
    setSwapId(null);
    edit((x) => switchPoint(x, cat.points, p));
  }

  /** Thêm món mới, hoặc thay dòng đang chọn (khách đổi món). */
  function putProduct(p: Product, tops: Topping[]) {
    const target = swapLine?.id;
    edit((x) => ({
      ...x,
      items: target ? replaceWithProduct(x.items, target, uuidv7(), p, tops, menuId) : addProduct(x.items, uuidv7(), p, tops, menuId),
    }));
    setSwapId(null);
  }

  function onCombo(c: Combo) {
    const target = swapLine?.id;
    edit((x) => ({
      ...x,
      items: target
        ? replaceWithCombo(x.items, target, uuidv7(), c, cat.products, cat.toppings, menuId)
        : addCombo(x.items, uuidv7(), c, cat.products, cat.toppings, menuId),
    }));
    setSwapId(null);
  }

  function onProduct(p: Product) {
    if (selectableToppings(cat.toppings, menuId).length === 0) {
      putProduct(p, []);
    } else {
      // Đổi topping của chính món đang chọn ⇒ bảng topping mở sẵn topping cũ.
      const initial = swapLine && swapLine.product_id === p.id ? swapLine.toppings_snap.map((t) => t.id) : [];
      setDialog({ kind: 'toppings', product: p, initial });
    }
  }

  function addWithToppings(p: Product, toppingIds: string[]) {
    const tops = toppingIds.map((id) => cat.toppings.find((t) => t.id === id)).filter((t): t is Topping => !!t);
    putProduct(p, tops);
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

  const done = (flash?: string) => navigate('/', { replace: true, state: flash ? ({ flash } satisfies QueueFlash) : null });

  const save = () => run(async () => {
    await flush();
    done();
  });
  const serve = () => run(async () => {
    const o = await flush();
    if (o.status === 'open') await pos.serveOrder(o.id);
    done();
  });
  const pay = () => run(async () => {
    const o = await flush();
    navigate(`/order/${o.id}/pay`);
  });
  /** Thu đủ tiền mặt ngay từ màn đơn: combo + thanh toán đủ tiền chỉ mất 3 chạm từ hàng đợi. */
  const payExact = () => run(async () => {
    const o = await flush();
    await pos.payOrder(o.id, { method: 'cash', cash_given: o.total });
    done(`Đã thu ${formatVnd(o.total)} – đơn ${o.code}`);
  });
  const remove = (reason: DeleteReason) => run(async () => {
    if (!saved) return;
    await pos.deleteOrder(saved.id, reason);
    setDialog(null);
    done(`Đã xóa đơn ${saved.code}`);
  });

  function back() {
    // Đơn đã lưu còn món: ghi nốt phần đang chờ tự lưu rồi về, không hỏi.
    // (Đơn ship bị xóa mất địa chỉ ⇒ không lưu được: hỏi bỏ thay đổi.)
    if (saved && !empty && !noAddress) void run(async () => {
      await flushAuto();
      navigate('/');
    });
    else if (dirty) setDialog({ kind: 'discard' });
    else navigate('/');
  }

  return (
    <main data-testid="order-screen" data-point={d.point_id} className="flex h-full flex-col gap-4 overflow-y-auto p-4 md:flex-row md:overflow-hidden">
      <div className="flex flex-col gap-3 md:min-w-0 md:flex-1 md:overflow-y-auto md:pr-1">
        {swapLine && (
          <div data-testid="swap-banner" role="status" className="sticky top-0 z-10 flex items-center gap-3 rounded-xl border border-brand-line bg-brand-soft px-4 py-3 text-lg font-medium text-brand-deep shadow-card">
            <ArrowLeftRight aria-hidden className="h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1">
              Đổi <b>{lineSummary(swapLine)}</b>: bấm món mới để thay
            </span>
            <button type="button" className="btn btn-secondary shrink-0" onClick={() => setSwapId(null)} data-testid="swap-cancel">
              <X aria-hidden className="h-5 w-5" />
              Thôi
            </button>
          </div>
        )}
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
          {saved ? (
            <span className="flex flex-col items-end">
              <span className="text-2xl font-bold">
                Đơn #
                <span className="font-mono tracking-wider" data-testid="order-code">
                  {saved.code}
                </span>
              </span>
              <span className="text-sm text-ink-subtle" data-testid="order-autosave" data-state={autoPending ? 'saving' : 'saved'}>
                {autoPending ? 'Đang lưu…' : empty ? 'Chưa lưu: đơn trống' : 'Đã lưu'}
              </span>
            </span>
          ) : (
            <span className="text-2xl font-bold" data-testid="order-code">
              Đơn mới
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-surface-sunken p-1" role="group" aria-label="Tại chỗ / Mang về / Ship">
          {DINE_TYPES.map(({ id: t, Icon }) => (
            <button
              key={t}
              type="button"
              aria-pressed={d.dine_type === t}
              onClick={() => edit((x) => setDineType(x, t))}
              className="btn min-h-[52px] px-2 text-ink-muted hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-card"
              data-testid={`order-dine-${t}`}
            >
              <Icon aria-hidden className="h-5 w-5 shrink-0" />
              {DINE_LABELS[t]}
            </button>
          ))}
        </div>

        {d.dine_type === 'delivery' && (
          <label className="flex flex-col gap-1">
            <span className="relative">
              <MapPin aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
              <input
                className="input pl-10"
                aria-label="Địa chỉ giao"
                aria-invalid={noAddress}
                placeholder="Địa chỉ giao, SĐT (bắt buộc)"
                maxLength={200}
                autoFocus={!d.address}
                value={d.address}
                onChange={(e) => edit((x) => ({ ...x, address: e.target.value }))}
                onFocus={() => setTypingAddress(true)}
                onBlur={() => setTypingAddress(false)}
                data-testid="order-address"
              />
            </span>
            {noAddress && (
              <span className="text-sm text-danger-strong" data-testid="order-address-missing">
                Nhập địa chỉ giao để lưu đơn ship
              </span>
            )}
          </label>
        )}

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
            <li
              key={it.id}
              data-testid={`cart-line-${it.id}`}
              data-product={it.product_id}
              data-swapping={swapLine?.id === it.id || undefined}
              className={`flex items-center gap-2 rounded-xl border p-2 pl-3 ${swapLine?.id === it.id ? 'border-brand bg-brand-soft ring-4 ring-brand/20' : 'border-line bg-surface-muted'}`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 rounded-lg py-1 text-left"
                aria-pressed={swapLine?.id === it.id}
                aria-label={`Đổi món ${lineSummary(it)}`}
                onClick={() => setSwapId((cur) => (cur === it.id ? null : it.id))}
                data-testid={`cart-line-${it.id}-pick`}
              >
                <span className="block text-lg font-medium leading-tight">{lineSummary({ ...it, qty: 1 }).replace(/^1× /, '')}</span>
                <span className="num text-base text-ink-subtle" data-testid={`cart-line-${it.id}-total`}>
                  {swapLine?.id === it.id ? 'Chọn món mới…' : formatVnd(lineTotal(it))}
                </span>
              </button>
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
          {error ?? (saved && empty ? 'Đơn không còn món nào: thêm món, hoặc bấm Xóa đơn.' : null)}
        </Notice>

        <button type="button" className="btn btn-success min-h-[64px] text-xl" disabled={blocked} onClick={() => void payExact()} data-testid="order-pay-exact">
          <Banknote aria-hidden className="h-6 w-6" />
          Thu đủ tiền mặt {formatVnd(total)}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-primary" disabled={blocked} onClick={() => void pay()} data-testid="order-pay">
            <Wallet aria-hidden className="h-5 w-5" />
            Thanh toán…
          </button>
          {saved?.status === 'served' ? (
            <span />
          ) : (
            <button type="button" className="btn btn-dark" disabled={blocked} onClick={() => void serve()} data-testid="order-serve">
              <ChefHat aria-hidden className="h-5 w-5" />
              Đã ra món
            </button>
          )}
          {!saved && (
            <button type="button" className="btn btn-secondary" disabled={blocked} onClick={() => void save()} data-testid="order-save">
              <Save aria-hidden className="h-5 w-5" />
              Tạo đơn
            </button>
          )}
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
          initial={dialog.initial}
          swapping={!!swapLine}
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
  initial,
  swapping,
  onAdd,
  onCancel,
}: {
  product: Product;
  toppings: Topping[];
  initial: string[];
  /** Đang đổi món ⇒ nút xác nhận thay dòng đã chọn chứ không thêm dòng mới. */
  swapping: boolean;
  onAdd: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => initial.filter((id) => toppings.some((t) => t.id === id)));
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
          {swapping ? 'Đổi' : 'Thêm'} · {formatVnd(price)}
        </button>
      </div>
    </Sheet>
  );
}
