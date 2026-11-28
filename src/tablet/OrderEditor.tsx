import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { ArrowLeftRight, Banknote, Bike, ChefHat, ChevronRight, ChevronUp, Check, MapPin, Minus, Plus, Receipt, Save, ShoppingBag, Tag, Trash2, UtensilsCrossed, Wallet, X } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import {
  addCombo,
  addProduct,
  canSwitchPoint,
  draftChanged,
  draftProblem,
  draftShip,
  draftTotal,
  lineSummary,
  newDraft,
  replaceWithCombo,
  replaceWithProduct,
  setCustomer,
  setDineType,
  setShipMode,
  stepLineQty,
  switchPoint,
  toDraftCustomer,
  toggleShipFee,
  toggleShipPayout,
  withShipDefaults,
  type CartDraft,
  type DraftCustomer,
} from '@/domain/cart';
import { DELETE_REASON_LABELS } from '@/domain/audit';
import { customerLabel } from '@/domain/debt';
import { soldOutAt, tabletPoints, type SoldOutSet } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { shipProblem } from '@/domain/orderWrite';
import { SHIP_FEES, SHIP_PAYOUTS, lineTotal, orderTotal, selectableToppings, shipFeeLabel } from '@/domain/pricing';
import { businessDate } from '@/domain/time';
import { DINE_LABELS, SHIP_MODE_LABELS, type Combo, type DeleteReason, type DineType, type Order, type Point, type Product, type ShipMode, type Topping } from '@/domain/types';
import { pos } from '@/lib/pos';
import { Splash, errorMessage } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { Badge, FIELD, FIELD_ICON, IconTile, ItemThumb, PayMethodTile, Segmented, SheetHandle, iconBtn, staffBtn } from '@/app/kit';
import { MenuBoard } from './MenuBoard';
import { Notice, Sheet, useTablet, type LeaveGuard } from './parts';
import { useDebtBook } from './debt';
import { ShipCustomerPicker } from './ShipCustomer';
import { ShipSheet } from './ShipSheet';
import { ReprintKitchenButton } from './PrinterStatus';
import type { ToastTone } from './Toast';
import { CartPay, DebtSheet, type ConfirmPay, type PayMethod } from './CartPay';
import type { PaymentInput } from '@/pos';

const DINE_TYPES: ReadonlyArray<{ id: DineType; Icon: typeof ShoppingBag }> = [
  { id: 'dinein', Icon: UtensilsCrossed },
  { id: 'takeaway', Icon: ShoppingBag },
  { id: 'delivery', Icon: Bike },
];

const SHIP_MODES: readonly ShipMode[] = ['shop', 'external'];

const DELETE_REASONS = (['mistake', 'customer_left', 'customer_changed', 'other'] as const).map((id) => ({ id, label: DELETE_REASON_LABELS[id] }));

/** Nút −/+ của dòng món (Figma BH2 / BHP2): 36 (điện thoại 34) nền xám bo 10. */
const QTY_BTN = 'flex h-[34px] w-[34px] shrink-0 md:h-9 md:w-9 items-center justify-center rounded-[10px] bg-[#f3f3f3] text-[#111] transition-colors duration-fast hover:bg-[#e9e9e9]';

const PAY_METHOD_KEYS = ['cash', 'transfer', 'debt'] as const;

/** Chờ ngần này sau lần sửa cuối mới tự lưu (gõ nhãn, bấm +/− liên tục chỉ ra một update_order). */
const AUTOSAVE_MS = 800;

type Dialog = { kind: 'toppings'; product: Product; initial: string[] } | { kind: 'delete' } | { kind: 'discard'; go: () => void } | null;

/** Giỏ xong việc với đơn đang sửa ⇒ về đơn mới trống. */
export interface OrderDone {
  /** Thông báo một lần (đã thu / đã xóa / đơn đổi ở máy khác). */
  toast?: { text: string; tone: ToastTone };
  /** Đơn vừa thanh toán trên máy này: thẻ rời hàng đợi kèm dấu "Đã thanh toán". */
  paidId?: string;
}

/**
 * Thực đơn + giỏ của màn Bán hàng (mục 4.2): tab điểm bán, combo (1 chạm), món → topping, Tại chỗ / Mang về / Ship (+ phí, địa chỉ), nhãn.
 * `orderId` = đơn đang chọn trong hàng đợi; null = đơn mới. Màn Bán hàng dựng lại component này mỗi khi đổi đơn đang chọn.
 * Điện thoại (Figma MS1 / MS2): chọn Ship không mở bàn phím; địa chỉ + khách nhập trong bảng riêng.
 * Nhân viên thấy giá nhưng không có ô nào để sửa giá hay giảm giá.
 * Đơn mới chỉ ghi lên server khi bấm Tạo đơn / Đã ra món / Thanh toán.
 * Đơn đã lưu thì tự lưu mỗi khi sửa (gom các chạm liên tiếp thành một update_order).
 * Máy khác sửa / thanh toán / xóa cùng đơn: đơn trong giỏ cập nhật theo (nếu chưa sửa dở) hoặc về đơn mới kèm thông báo.
 *
 * Phần tử gốc là `display: contents`: thực đơn và giỏ đặt thẳng vào lưới của màn Bán hàng (cột giữa / cột phải).
 */
export function OrderEditor({
  orderId,
  leaveRef,
  onDone,
  onClose,
  hideCard,
}: {
  orderId: string | null;
  /** Màn Bán hàng gọi trước khi đổi đơn đang chọn / sang màn khác (luật rời đơn). */
  leaveRef: MutableRefObject<LeaveGuard | null>;
  /** Lưu / ra món / thanh toán / xóa xong, hoặc đơn biến mất ⇒ về đơn mới trống. */
  onDone: (r: OrderDone) => void;
  /** Bỏ chọn đơn (nút ✕), đã qua luật rời đơn. */
  onClose: () => void;
  /** Ẩn thẻ của đơn vừa tạo đang thu tiền ngay (null = hiện lại). */
  hideCard: (id: string | null) => void;
}) {
  const { catalog, orders, lastPointId, setLastPointId } = useTablet();
  const [saved, setSaved] = useState<Order | null>(null);
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** Dòng đang chọn để đổi món: bấm món / combo kế tiếp sẽ thay dòng này thay vì thêm mới. */
  const [swapId, setSwapId] = useState<string | null>(null);
  /**
   * Đang thanh toán trong giỏ (đơn đã lưu): hình thức đang mở. Ghi nợ là bảng đè lên giỏ; `back` = hình thức đang mở trước đó
   * (đóng bảng ghi nợ ⇒ về đó, null ⇒ về giỏ).
   */
  const [paying, setPaying] = useState<{ method: PayMethod; back: PayMethod | null } | null>(null);
  /** Điện thoại: giỏ đang mở rộng (tablet luôn hiện đủ). Chọn đơn trong hàng đợi ⇒ mở sẵn. */
  const [cartOpen, setCartOpen] = useState(!!orderId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Chế độ báo hết món (mục 4.8) + món đang gửi lên server. */
  const [marking, setMarking] = useState(false);
  const [markingPending, setMarkingPending] = useState<string | null>(null);
  /** Đang gõ địa chỉ: chưa tự lưu (mỗi lần đổi địa chỉ đơn ship là một tin Telegram), lưu khi rời ô. */
  const [typingAddress, setTypingAddress] = useState(false);
  /** Điện thoại: bảng nhập địa chỉ / khách đơn ship đang mở (cũng tạm dừng tự lưu như đang gõ địa chỉ). */
  const [shipOpen, setShipOpen] = useState(false);
  const isTablet = useIsTablet();
  const busyRef = useRef(false);

  // Các lần ghi (tự lưu và nút bấm) chạy nối tiếp, luôn đọc bản nháp / đơn mới nhất qua ref.
  const savedRef = useRef<Order | null>(null);
  const draftRef = useRef<CartDraft | null>(null);
  savedRef.current = saved;
  draftRef.current = draft;
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  /** Id của đơn mới, cố định cho tới khi tạo xong: bấm lại sau lỗi mạng không tạo đơn thứ hai. */
  const newIdRef = useRef(uuidv7());
  /** Đơn được tạo trong giỏ này (thu tiền ngay ⇒ không hiện thẻ "Đã thanh toán"). */
  const createdHere = useRef<string | null>(null);
  /** Đã báo xong (về đơn mới): đổi URL là chuyển tiếp chậm, trong lúc chờ không phản ứng với đơn biến mất nữa. */
  const finished = useRef(false);

  /** Ghi bản nháp: đơn mới ⇒ create_order; đơn cũ có thay đổi ⇒ update_order. */
  async function persist(): Promise<Order> {
    const x = draftRef.current!;
    const s = savedRef.current;
    setLastPointId(x.point_id);
    const fields = {
      point_id: x.point_id,
      dine_type: x.dine_type,
      label: x.label,
      address: x.address,
      customer: x.customer,
      ship_fee: x.ship_fee,
      ship_mode: x.ship_mode,
      ship_payout: x.ship_payout,
      items: x.items,
    };
    let o: Order;
    if (!s) {
      // Từ đây đơn đã có trên server (savedRef bên dưới): bước sau lỗi rồi bấm lại là sửa chứ không tạo đơn thứ hai.
      o = await pos.createOrder({ id: newIdRef.current, ...fields });
      createdHere.current = o.id;
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
    if (!s || !x || draftProblem(x) || !draftChanged(x, s)) return queueRef.current;
    return flush();
  }

  const autoPending = !!saved && !!draft && !draftProblem(draft) && draftChanged(draft, saved);
  useEffect(() => {
    if (!autoPending || typingAddress || shipOpen) return;
    const t = setTimeout(() => {
      flushAuto().catch((e) => setError(errorMessage(e)));
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPending, draft, typingAddress, shipOpen]);

  // Tablet tắt màn / chuyển app giữa chừng: ghi luôn phần đang chờ. Rời giỏ (vd. nút Back của trình duyệt) cũng vậy.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushAuto().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flushAuto().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Màn Bán hàng gọi luật rời đơn qua `leaveRef` (hàm cố định cho cả vòng đời giỏ này, luôn chạy bản mới nhất).
  const latestLeave = useRef<LeaveGuard>((go) => go());
  const stableLeave = useRef<LeaveGuard>((go) => latestLeave.current(go));
  leaveRef.current = stableLeave.current;
  useEffect(
    () => () => {
      if (leaveRef.current === stableLeave.current) leaveRef.current = null;
    },
    [leaveRef],
  );

  const points = useMemo(() => (catalog ? tabletPoints(catalog.profile, catalog.points) : []), [catalog]);
  const book = useDebtBook();

  /** Bản mới nhất của đơn đang sửa trên server (cập nhật realtime). */
  const remote = (saved ?? orderId) ? (orders.find((o) => o.id === (saved?.id ?? orderId)) ?? null) : null;

  // Nạp đơn (sửa) hoặc dựng bản nháp mới ở điểm bán gần nhất.
  useEffect(() => {
    if (orderId) {
      if (!remote) {
        // đã thanh toán / đã xóa / không có
        finished.current = true;
        return void onDone({});
      }
      adopt(remote);
    } else if (!draft && points.length > 0) {
      setDraft(newDraft(points.find((p) => p.id === lastPointId) ?? points[0], pos.cachedShipDefaults()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, points.length]);

  // Đơn mới: kiểu ship / phí / trả shipper mặc định theo đơn ship gần nhất của ca (hỏi server, mọi máy cùng quầy giống nhau).
  // Đến muộn thì chỉ áp khi đơn chưa lưu và nhân viên chưa tự bấm.
  useEffect(() => {
    if (orderId) return;
    let live = true;
    void pos.shipDefaults().then((v) => {
      if (live && !savedRef.current) setDraft((prev) => (prev ? withShipDefaults(prev, v) : prev));
    });
    return () => {
      live = false;
    };
  }, [orderId]);

  // Máy khác vừa đổi đơn này. Đang sửa dở / đang lưu ⇒ giữ bản trên màn (lần lưu tới ghi đè);
  // chưa sửa gì ⇒ hiện bản mới. Đơn bị thanh toán / xóa ở máy khác ⇒ về đơn mới kèm thông báo.
  useEffect(() => {
    const s = savedRef.current;
    if (!s || busyRef.current || finished.current) return;
    if (!remote) {
      finished.current = true;
      onDone({ toast: { text: `Đơn ${s.code} đã được thanh toán hoặc xóa ở máy khác`, tone: 'info' } });
      return;
    }
    if (remote === s) return;
    const x = draftRef.current;
    if (x && !draftChanged(x, s)) adopt(remote);
    else setSaved(remote);
    // `busy`: đơn biến mất đúng lúc đang ghi (vd. server từ chối vì máy khác vừa thu) ⇒ xét lại khi ghi xong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, busy]);

  function adopt(o: Order) {
    savedRef.current = o;
    setSaved(o);
    setDraft((prev) => ({
      point_id: o.point_id,
      dine_type: o.dine_type,
      dine_type_touched: true,
      label: o.label ?? '',
      address: o.address ?? '',
      customer: customerOf(o, prev?.customer ?? null),
      ship_fee: o.ship_fee ?? 0,
      ship_mode: o.ship_mode ?? 'shop',
      ship_payout: o.ship_payout ?? 0,
      ship_touched: true,
      items: o.items,
    }));
  }

  /** Khách của đơn đã lưu, lấy từ danh sách khách (khách vừa tạo chưa có trong danh sách ⇒ giữ bản trên màn). */
  function customerOf(o: Order, current: DraftCustomer | null): DraftCustomer | null {
    if (!o.customer_id) return null;
    const c = catalog?.customers.find((x) => x.id === o.customer_id);
    if (c) return toDraftCustomer(c);
    if (current?.id === o.customer_id) return current;
    return { id: o.customer_id, name: 'Khách', description: null, phone: null, address: null, is_new: false };
  }

  // Chủ vừa bỏ điểm bán đang chọn khỏi hồ sơ tablet (danh mục mới đồng bộ về) ⇒ đơn chưa có món về điểm đầu tiên.
  const pointGone = !!draft && points.length > 0 && !points.some((p) => p.id === draft.point_id);
  useEffect(() => {
    if (pointGone && draft && draft.items.length === 0) setDraft(switchPoint(draft, points, points[0]));
  }, [pointGone, draft, points]);

  const cell = 'min-h-0 md:col-start-1 md:row-start-2';
  if (!catalog)
    return (
      <div className={cell}>
        <Splash />
      </div>
    );
  if (points.length === 0) {
    return (
      <div className={`${cell} p-6`}>
        <p data-testid="menu-no-points" className="text-ink-subtle">
          Quầy này chưa có điểm bán nào. Nhờ chủ chọn điểm bán trong Cài đặt.
        </p>
      </div>
    );
  }
  if (!draft)
    return (
      <div className={cell}>
        <Splash />
      </div>
    );

  const cat = catalog;
  const d = draft;
  const point = cat.points.find((p) => p.id === d.point_id);
  const menuId = point?.menu_id ?? '';
  const total = draftTotal(d);
  const dirty = saved ? draftChanged(d, saved) : d.items.length > 0 || d.label.trim() !== '' || d.address.trim() !== '' || d.customer !== null;
  const empty = d.items.length === 0;
  /** Đơn ship chưa nhập địa chỉ / shipper ngoài chưa chọn tiền trả shipper: chưa lưu / ra món / thanh toán được. */
  const problem = draftProblem(d);
  const noAddress = problem === 'address_required';
  // Thiếu cả địa chỉ lẫn tiền trả shipper ⇒ báo cả hai (server chỉ trả lý do đầu tiên).
  const noPayout = shipProblem(d) === 'bad_ship_payout';
  const blocked = !!problem || busy;
  // Dòng đang chọn đã bị bớt hết / đổi đi ⇒ coi như không chọn.
  const swapLine = swapId ? (d.items.find((it) => it.id === swapId) ?? null) : null;
  const soldOut = soldOutAt(cat.sold_out, d.point_id, businessDate(new Date(), cat.config.timezone));

  async function toggleSoldOut(kind: 'product' | 'topping', id: string, sold_out: boolean) {
    if (markingPending) return;
    setError(null);
    setMarkingPending(`${kind}:${id}`);
    try {
      await pos.setSoldOut({ point_id: d.point_id, item_kind: kind, item_id: id, sold_out });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMarkingPending(null);
    }
  }

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
      items: target ? replaceWithCombo(x.items, target, uuidv7(), c, cat.products, cat.toppings, menuId) : addCombo(x.items, uuidv7(), c, cat.products, cat.toppings, menuId),
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

  const done = (r: OrderDone = {}) => {
    finished.current = true;
    onDone(r);
  };

  const save = () =>
    run(async () => {
      await flush();
      done();
    });
  const serve = () =>
    run(async () => {
      const o = await flush();
      if (o.status === 'open') await pos.serveOrder(o.id);
      done();
    });
  /** Mở thanh toán trong giỏ: lưu đơn trước (đơn mới ⇒ tạo đơn), rồi hiện phần TM / CK / bảng Ghi nợ. */
  const openPay = (method: PayMethod) =>
    run(async () => {
      await flush();
      setSwapId(null);
      setCartOpen(true);
      setPaying({ method, back: null });
    });
  const pickPayMethod = (method: PayMethod) => setPaying((cur) => ({ method, back: method === 'debt' ? (cur?.method ?? null) : null }));
  const confirmPay: ConfirmPay = (payment: PaymentInput, text: string) =>
    void run(async () => {
      const o = savedRef.current!;
      // Như "Thu đủ": đơn vừa tạo trong giỏ này không hiện thẻ "Đã thanh toán"; đơn đã có thẻ thì có.
      const fresh = createdHere.current === o.id;
      if (fresh) hideCard(o.id);
      try {
        await pos.payOrder(o.id, payment);
        done({ toast: { text, tone: 'ok' }, paidId: fresh ? undefined : o.id });
      } catch (e) {
        if (fresh) hideCard(null);
        throw e;
      }
    });
  /** Thu đủ tiền mặt ngay từ giỏ: combo + thanh toán đủ tiền chỉ mất 2–3 chạm từ màn Bán hàng. */
  const payExact = () =>
    run(async () => {
      // Đơn mới: thẻ không hiện trong hàng đợi (chỉ lóe lên rồi mất). Đơn đã có thẻ ⇒ thẻ hiện "Đã thanh toán" rồi biến mất.
      const fresh = !savedRef.current || createdHere.current === savedRef.current.id;
      if (fresh) hideCard(savedRef.current?.id ?? newIdRef.current);
      try {
        const o = await flush();
        await pos.payOrder(o.id, { method: 'cash', cash_given: o.total });
        done({ toast: { text: `Đã thu ${formatVnd(o.total)} – đơn ${o.code}`, tone: 'ok' }, paidId: fresh ? undefined : o.id });
      } catch (e) {
        if (fresh) hideCard(null);
        throw e;
      }
    });
  const remove = (reason: DeleteReason) =>
    run(async () => {
      if (!saved) return;
      await pos.deleteOrder(saved.id, reason);
      setDialog(null);
      done({ toast: { text: `Đã xóa đơn ${saved.code}`, tone: 'info' } });
    });

  /**
   * Luật rời đơn (bỏ chọn, chọn thẻ khác, sang màn khác): đơn đã lưu ⇒ ghi nốt phần đang chờ tự lưu rồi đi, không hỏi.
   * Đơn mới đã có món, hoặc đơn ship không lưu được (mất địa chỉ / thiếu tiền trả shipper) ⇒ hỏi "Bỏ thay đổi?".
   */
  function requestLeave(go: () => void) {
    if (busyRef.current) return;
    if (saved && !problem)
      void run(async () => {
        await flushAuto();
        go();
      });
    else if (dirty) setDialog({ kind: 'discard', go });
    else go();
  }
  latestLeave.current = requestLeave;

  const itemCount = d.items.reduce((s, it) => s + it.qty, 0);
  /** Điện thoại: tiêu đề hàng tóm tắt giỏ (Figma BHP1 / BHP2): "Đơn mới · 5 món", "#K7Q · Bàn 3". */
  const phoneTitle = `${saved ? `#${saved.code}` : 'Đơn mới'} · ${empty ? 'chưa có món' : saved && d.label.trim() ? d.label.trim() : `${itemCount} món`}`;
  /** Điện thoại: sheet giỏ phủ cả phần thực đơn (giỏ mở rộng, đang thanh toán; Figma BHP2 / BHP4 / BHP6). */
  const sheetFull = !isTablet && (cartOpen || !!paying);
  const isShip = d.dine_type === 'delivery';
  const { ship_fee: shipFee, ship_mode: shipMode, ship_payout: payout } = draftShip(d);
  const external = shipMode === 'external';
  /** Shipper ngoài: phí ship gọi là "Phụ thu". */
  const feeNoun = external ? 'Phụ thu' : 'Phí ship';
  const cartQty = (productId: string) => d.items.reduce((s, it) => s + (it.product_id === productId ? it.qty : 0), 0);

  const chip = (on: boolean) =>
    `flex h-9 min-w-0 flex-1 items-center justify-center rounded-xl px-2 text-sm font-semibold leading-[18px] transition-colors duration-fast ${
      on ? 'border-[1.5px] border-brand bg-[#ffeee7] text-[#c2380a]' : 'border border-line bg-white text-[#111] hover:border-[#cfcfcf]'
    }`;
  /** Hàng chọn mức tiền (Figma BH6 / BH7): nhãn 84 bên trái, 4 chip chia đều. */
  const amountRow = (title: string, titleTestId: string | undefined, extra: ReactNode, chips: ReactNode) => (
    <div className="flex shrink-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-[84px] shrink-0 text-[13px] font-semibold leading-[17px] text-[#6d6d6d]" data-testid={titleTestId}>
          {title}
        </span>
        <div className="flex min-w-0 flex-1 gap-2" role="group" aria-label={title}>
          {chips}
        </div>
      </div>
      {extra}
    </div>
  );

  const dineSegment = (
    <Segmented
      stretch
      className="shrink-0"
      label="Tại chỗ / Mang về / Ship"
      value={d.dine_type}
      onChange={(t) => edit((x) => setDineType(x, t))}
      options={DINE_TYPES.map(({ id, Icon }) => ({ key: id, label: DINE_LABELS[id], icon: Icon, testId: `order-dine-${id}` }))}
    />
  );

  const shipFields = isShip && (
    <>
      <Segmented
        stretch
        small
        className="shrink-0"
        label="Kiểu ship"
        value={d.ship_mode}
        onChange={(m) => edit((x) => setShipMode(x, m))}
        options={SHIP_MODES.map((m) => ({ key: m, label: SHIP_MODE_LABELS[m], testId: `order-ship-mode-${m}` }))}
      />
      {/* Bấm lại mức đang chọn ⇒ bỏ phí. */}
      {amountRow(
        feeNoun,
        'order-ship-fee-title',
        null,
        SHIP_FEES.map((fee) => (
          <button
            key={fee}
            type="button"
            aria-pressed={d.ship_fee === fee}
            onClick={() => edit((x) => toggleShipFee(x, fee))}
            className={chip(d.ship_fee === fee)}
            data-testid={`order-ship-fee-${fee}`}
          >
            {shipFeeLabel(fee)}
          </button>
        )),
      )}
      {/* Bắt buộc chọn: bấm lại mức đang chọn không bỏ được. Không cộng vào tổng đơn. */}
      {external &&
        amountRow(
          'Trả shipper (tiền két)',
          undefined,
          noPayout && (
            <span className="pl-[92px] text-[13px] font-medium text-[#b91c1c]" data-testid="order-payout-missing">
              Chưa chọn tiền trả shipper
            </span>
          ),
          SHIP_PAYOUTS.map((v) => (
            <button key={v} type="button" aria-pressed={payout === v} onClick={() => edit((x) => toggleShipPayout(x, v))} className={chip(payout === v)} data-testid={`order-ship-payout-${v}`}>
              {shipFeeLabel(v)}
            </button>
          )),
        )}
    </>
  );

  const labelField = (
    <span className="relative shrink-0">
      <Tag aria-hidden className={FIELD_ICON} />
      <input
        className={`${FIELD} pl-[39px]`}
        aria-label="Nhãn / số bàn"
        placeholder="Nhãn / số bàn (tùy chọn)"
        maxLength={40}
        value={d.label}
        onChange={(e) => edit((x) => ({ ...x, label: e.target.value }))}
        data-testid="order-label"
      />
    </span>
  );

  /** Dòng món (Figma BH2): ô ảnh, tên, topping dòng phụ, thành tiền cam đậm, −/+ 36. Bấm tên ⇒ chọn dòng để đổi món. */
  const cartLines = (
    <ul className={`${cartOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-y-auto md:flex md:min-h-fit md:overflow-visible md:px-4`} data-testid="cart-lines">
      {empty && (
        <li className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f4f4f4] text-[#b5b5b5]">
            <ShoppingBag className="h-7 w-7" />
          </span>
          <span className="text-base font-semibold leading-5 text-[#111]">Chưa có món</span>
          <span className="text-[13px] leading-4 text-[#888]">Bấm combo hoặc món để thêm</span>
        </li>
      )}
      {d.items.map((it) => {
        const picking = swapLine?.id === it.id;
        return (
          <li
            key={it.id}
            data-testid={`cart-line-${it.id}`}
            data-product={it.product_id}
            data-swapping={picking || undefined}
            className={`flex items-center gap-3 border-b py-2 last:border-b-0 md:py-3 ${picking ? 'rounded-xl border-brand bg-[#ffeee7] px-2 ring-2 ring-brand/30' : 'border-line'}`}
          >
            <ItemThumb className="h-11 w-11 rounded-xl md:h-[52px] md:w-[52px]" iconClass="h-5 w-5 md:h-6 md:w-6" />
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-lg text-left"
              aria-pressed={picking}
              aria-label={`Đổi món ${lineSummary(it)}`}
              onClick={() => {
                // Điện thoại: chọn dòng để đổi ⇒ thu gọn giỏ cho thấy thực đơn.
                if (!picking) setCartOpen(false);
                setSwapId((cur) => (cur === it.id ? null : it.id));
              }}
              data-testid={`cart-line-${it.id}-pick`}
            >
              <span className="truncate text-sm font-semibold leading-[18px] text-[#111]">{it.name_snap}</span>
              {it.toppings_snap.length > 0 && <span className="truncate text-xs leading-[15px] text-[#888]">+ {it.toppings_snap.map((t) => t.name).join(', ')}</span>}
              <span className="num text-[13px] font-semibold leading-4 text-[#c2380a]" data-testid={`cart-line-${it.id}-total`}>
                {picking ? 'Chọn món mới…' : formatVnd(lineTotal(it))}
              </span>
            </button>
            <span className="flex shrink-0 items-center gap-1">
              <button type="button" className={QTY_BTN} onClick={() => edit((x) => ({ ...x, items: stepLineQty(x.items, it.id, -1) }))} aria-label="Bớt" data-testid={`cart-line-${it.id}-minus`}>
                <Minus aria-hidden className="h-[18px] w-[18px]" />
              </button>
              <span className="num w-[26px] text-center text-[15px] font-bold leading-[19px] text-[#111]" data-testid={`cart-line-${it.id}-qty`}>
                {it.qty}
              </span>
              <button type="button" className={QTY_BTN} onClick={() => edit((x) => ({ ...x, items: stepLineQty(x.items, it.id, 1) }))} aria-label="Thêm" data-testid={`cart-line-${it.id}-plus`}>
                <Plus aria-hidden className="h-[18px] w-[18px]" />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );

  const errorNotice = (
    <Notice testId="order-error" tone="error">
      {error ?? (saved && empty ? 'Đơn không còn món nào: thêm món, hoặc bấm Xóa đơn.' : null)}
    </Notice>
  );

  const payExactBtn = (
    <button type="button" className={staffBtn('primary', 'lg', 'w-full shrink-0 max-md:min-h-12')} disabled={blocked} onClick={() => void payExact()} data-testid="order-pay-exact">
      <Banknote aria-hidden />
      <span>
        Thu đủ tiền mặt · <span className="num">{formatVnd(total)}</span>
      </span>
    </button>
  );

  const actionRow = (
    <div className="order-2 grid shrink-0 grid-cols-2 gap-2 md:order-none">
      {saved?.status !== 'served' && (
        <button type="button" className={staffBtn('secondary')} disabled={blocked} onClick={() => void serve()} data-testid="order-serve">
          <ChefHat aria-hidden />
          Đã ra món
        </button>
      )}
      {!saved && (
        <button type="button" className={staffBtn('secondary')} disabled={blocked} onClick={() => void save()} data-testid="order-save">
          <Save aria-hidden />
          Tạo đơn
        </button>
      )}
      {saved && (
        <button
          type="button"
          className={staffBtn('danger', 'md', saved.status === 'served' ? 'col-span-2' : '')}
          disabled={busy}
          onClick={() => setDialog({ kind: 'delete' })}
          data-testid="order-delete"
        >
          <Trash2 aria-hidden />
          Xóa đơn
        </button>
      )}
    </div>
  );

  // Điện thoại: hàng đợi ở trên, thực đơn cuộn ở giữa, giỏ (thu gọn còn một dòng) + nút thao tác luôn ở đáy:
  // bấm món là thấy ngay số món / tổng tiền, không phải cuộn xuống mới tạo đơn được.
  // Tablet (md+), theo Figma: hàng đợi + thực đơn ở cột giữa, cột giỏ trắng bên phải (đầu đơn ở đầu cột).
  return (
    <div data-testid="order-screen" data-point={d.point_id} data-order={saved?.id} className="contents">
      <div className={`${sheetFull ? 'hidden' : 'flex'} row-start-2 min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 md:col-start-1 md:flex md:p-5`}>
        {swapLine && (
          <div
            data-testid="swap-banner"
            role="status"
            className="sticky top-0 z-10 flex items-center gap-3 rounded-xl border border-brand-line bg-brand-soft px-4 py-3 text-lg font-medium text-brand-deep shadow-card"
          >
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
          cartQty={cartQty}
          soldOut={soldOut}
          marking={{
            active: marking,
            onToggleActive: () => {
              setSwapId(null);
              setMarking((m) => !m);
            },
            onToggle: (kind, id, v) => void toggleSoldOut(kind, id, v),
            pending: markingPending,
          }}
        />
      </div>

      <aside
        data-testid="cart"
        className={`${sheetFull ? 'row-span-2 row-start-2' : 'row-start-3 max-h-[78vh]'} relative flex min-w-0 flex-col gap-2.5 rounded-t-3xl bg-white px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-2 shadow-raised md:col-start-2 md:row-span-2 md:row-start-1 md:max-h-none md:min-h-0 md:gap-0 md:rounded-none md:border-l md:border-line md:p-0 md:shadow-none`}
      >
        <SheetHandle className="md:hidden" />
        {/* Đầu giỏ. Tablet (Figma BH1 / BH3): ô icon, "Đơn mới" / "Đơn #mã" + trạng thái lưu, in lại phiếu bếp, ✕ bỏ chọn.
            Điện thoại (Figma BHP1 / BHP2): một hàng tóm tắt (ô túi + số món, tiêu đề, tổng), bấm để mở / thu gọn giỏ; đang chọn đơn ⇒ in lại + ✕ thay mũi tên. */}
        <div className="flex shrink-0 items-center gap-3 md:border-b md:border-line md:px-4 md:py-3.5">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left md:hidden" aria-expanded={cartOpen} onClick={() => setCartOpen((v) => !v)} data-testid="cart-toggle">
            <span className="icon-tile relative h-11 w-11 rounded-xl bg-[#ffeee7] text-brand">
              <ShoppingBag aria-hidden className="h-[22px] w-[22px]" />
              {itemCount > 0 && (
                <span className="num absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-brand px-1 text-[11px] font-bold leading-[14px] text-white">
                  {itemCount}
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px] font-bold leading-[19px] text-[#111]">{phoneTitle}</span>
              {shipFee > 0 || payout > 0 ? (
                <span className="num truncate text-xs leading-[15px] text-[#888]" data-testid="cart-ship-breakdown">
                  {formatVnd(orderTotal(d.items))}
                  {shipFee > 0 && ` + ${external ? 'phụ thu' : 'phí'} ${formatVnd(shipFee)}`}
                  {payout > 0 && ` · trả ship ${formatVnd(payout)}`}
                </span>
              ) : (
                <span className="truncate text-xs leading-[15px] text-[#888]">{cartOpen ? 'Bấm để thu gọn' : 'Bấm để xem giỏ'}</span>
              )}
            </span>
            <span className="num shrink-0 text-lg font-bold leading-[23px] text-[#111]" data-testid="cart-total">
              {formatVnd(total)}
            </span>
            {!saved && <ChevronUp aria-hidden className={`h-5 w-5 shrink-0 text-[#6d6d6d] transition-transform duration-fast ${cartOpen ? 'rotate-180' : ''}`} />}
          </button>
          <IconTile icon={Receipt} className="hidden h-11 w-11 rounded-xl md:flex" iconClass="h-[22px] w-[22px]" tone="bg-[#ffeee7] text-brand" />
          {saved ? (
            <span className="hidden min-w-0 flex-1 flex-col gap-1 md:flex">
              <span className="truncate text-lg font-bold leading-[23px] text-[#111]">
                Đơn #
                <span className="font-mono leading-none tracking-wider" data-testid="order-code">
                  {saved.code}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={autoPending ? 'amber' : empty ? 'gray' : 'green'} icon={autoPending || empty ? undefined : Check} testId="order-autosave" data-state={autoPending ? 'saving' : 'saved'}>
                  {autoPending ? 'Đang lưu…' : empty ? 'Chưa lưu: đơn trống' : 'Đã lưu'}
                </Badge>
                {saved.status === 'open' ? (
                  <Badge tone="amber" icon={ChefHat} testId="order-status">
                    Chờ ra món
                  </Badge>
                ) : (
                  <Badge tone="blue" icon={Wallet} testId="order-status">
                    Chờ thanh toán
                  </Badge>
                )}
              </span>
            </span>
          ) : (
            <span className="hidden min-w-0 flex-1 flex-col gap-1 md:flex">
              <span className="text-lg font-bold leading-[23px] text-[#111]" data-testid="order-code">
                Đơn mới
              </span>
              <span className="text-xs leading-[15px] text-[#888]">{empty ? 'Chưa có món' : 'Chưa lưu'}</span>
            </span>
          )}
          {saved && (
            <span className="flex shrink-0 items-center gap-2">
              <ReprintKitchenButton orderId={saved.id} code={saved.code} testId="order-reprint" className="h-9 w-9 md:h-10 md:w-10" />
              <button
                type="button"
                className={iconBtn('h-9 w-9 md:h-10 md:w-10')}
                onClick={() => requestLeave(onClose)}
                aria-label="Bỏ chọn, về đơn mới"
                title="Bỏ chọn, về đơn mới"
                data-testid="order-deselect"
              >
                <X aria-hidden className="h-4 w-4 md:h-[18px] md:w-[18px]" />
              </button>
            </span>
          )}
        </div>
        {paying && saved ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <CartPay
              key={saved.id}
              order={saved}
              method={paying.method}
              busy={busy}
              error={paying.method === 'debt' ? null : error}
              onMethod={pickPayMethod}
              onBack={() => {
                setError(null);
                setPaying(null);
              }}
              onConfirm={confirmPay}
            />
          </div>
        ) : (
          <>
            {/* Tablet: loại đơn + nhãn + món cuộn chung, đơn ship (nhiều hàng chọn) không đẩy phần tóm tắt ra khỏi cột (Figma BH7).
                Điện thoại: `contents`, các phần nằm thẳng trong sheet giỏ; nhãn + dòng món chỉ hiện khi mở rộng. */}
            <div className="contents md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto">
              <div className="contents md:flex md:shrink-0 md:flex-col md:gap-2.5 md:px-4 md:py-3.5">
                {dineSegment}
                {shipFields}
                {/* Điện thoại: chỉ một dòng bấm để mở bảng nhập địa chỉ / khách (không bật bàn phím khi chọn Ship). */}
                {isShip && !isTablet && (
                  <button
                    type="button"
                    className="flex min-h-[44px] shrink-0 items-center gap-3 rounded-xl border border-line-strong bg-surface px-3 text-left"
                    onClick={() => setShipOpen(true)}
                    data-testid="order-ship-details"
                  >
                    <MapPin aria-hidden className={`h-5 w-5 shrink-0 ${noAddress ? 'text-danger-strong' : 'text-ink-subtle'}`} />
                    {noAddress ? (
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-danger-strong" data-testid="order-address-missing">
                        Địa chỉ, khách — bấm để nhập
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="order-ship-summary">
                        {d.address.trim()}
                        {d.customer && <span className="text-ink-subtle"> · {customerLabel(d.customer)}</span>}
                      </span>
                    )}
                    <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-ink-subtle" />
                  </button>
                )}
                {isShip && isTablet && <ShipCustomerPicker book={book} customer={d.customer} autoFocus={!d.address} onChange={(c) => edit((x) => setCustomer(x, c))} />}
                {isShip && isTablet && (
                  <label className="flex shrink-0 flex-col gap-1">
                    <span className="relative">
                      <MapPin aria-hidden className={FIELD_ICON} />
                      <input
                        className={`${FIELD} pl-[39px]`}
                        aria-label="Địa chỉ giao"
                        aria-invalid={noAddress}
                        placeholder={d.customer?.phone ? 'Địa chỉ giao (bắt buộc)' : 'Địa chỉ giao, SĐT (bắt buộc)'}
                        maxLength={200}
                        autoFocus={!d.address && !!d.customer}
                        value={d.address}
                        onChange={(e) => edit((x) => ({ ...x, address: e.target.value }))}
                        onFocus={() => setTypingAddress(true)}
                        onBlur={() => setTypingAddress(false)}
                        data-testid="order-address"
                      />
                    </span>
                    {noAddress && (
                      <span className="text-[13px] font-medium text-[#b91c1c]" data-testid="order-address-missing">
                        Nhập địa chỉ giao để lưu đơn ship
                      </span>
                    )}
                  </label>
                )}
                <span className={`${cartOpen ? 'contents' : 'hidden'} md:contents`}>{labelField}</span>
              </div>
              {cartLines}
            </div>
            {/* Tablet: tóm tắt dạng sheet (Figma BH2): số món, phí, tổng, trả shipper, hình thức thanh toán, nút.
                Điện thoại: `contents`, chỉ còn nút (tổng ở dòng tóm tắt); thứ tự Thu đủ → TM / CK / Ghi nợ → nút phụ bằng `order`. */}
            <div className="contents md:relative md:flex md:shrink-0 md:flex-col md:gap-3 md:rounded-t-[20px] md:bg-white md:px-4 md:pb-4 md:pt-2.5 md:shadow-[0_-6px_24px_rgba(0,0,0,0.08)]">
              <SheetHandle className="hidden md:block" />
              <div className="hidden flex-col gap-1.5 text-sm leading-[18px] md:flex">
                <span className="flex items-center justify-between text-[#6d6d6d]">
                  Số món <span className="num font-semibold text-[#111]">{itemCount}</span>
                </span>
                {shipFee > 0 && (
                  <span className="flex items-center justify-between text-[#6d6d6d]">
                    {feeNoun}
                    <span className="num font-semibold text-[#111]" data-testid="order-ship-fee">
                      {formatVnd(shipFee)}
                    </span>
                  </span>
                )}
              </div>
              <span className="hidden items-center justify-between md:flex">
                <span className="text-base font-bold leading-5 text-[#111]">Tổng</span>
                <span className="num text-2xl font-bold leading-[30px] text-[#111]" data-testid="order-total">
                  {formatVnd(total)}
                </span>
              </span>
              {payout > 0 && (
                <span className="hidden items-center justify-between text-sm font-semibold leading-[18px] text-[#b91c1c] md:flex" data-testid="order-ship-payout-line">
                  Trả shipper (lấy từ két)
                  <span className="num">{formatVnd(-payout)}</span>
                </span>
              )}
              <span aria-hidden className="hidden h-px shrink-0 bg-line md:block" />
              <span className="hidden text-[13px] font-semibold leading-4 text-[#6d6d6d] md:block">Hình thức thanh toán</span>
              {/* Thanh toán hình thức khác: mở ngay trong giỏ. */}
              <div className="order-1 grid shrink-0 grid-cols-3 gap-2 md:order-none md:gap-2.5" role="group" aria-label="Hình thức thanh toán">
                {PAY_METHOD_KEYS.map((m) => (
                  <PayMethodTile key={m} method={m} inline={!isTablet} disabled={blocked} onClick={() => void openPay(m)} data-testid={`order-pay-${m}`} />
                ))}
              </div>
              {errorNotice}
              {payExactBtn}
              {actionRow}
            </div>
          </>
        )}
        {paying?.method === 'debt' && saved && (
          <DebtSheet
            order={saved}
            busy={busy}
            error={error}
            onClose={() => {
              setError(null);
              setPaying((cur) => (cur?.back ? { method: cur.back, back: null } : null));
            }}
            onConfirm={confirmPay}
          />
        )}
      </aside>

      {shipOpen && isShip && !isTablet && (
        <ShipSheet
          address={d.address}
          customer={d.customer}
          book={book}
          shipFee={shipFee}
          shipMode={shipMode}
          payout={payout}
          total={total}
          onAddress={(v) => edit((x) => ({ ...x, address: v }))}
          onCustomer={(c) => edit((x) => setCustomer(x, c))}
          onClose={() => setShipOpen(false)}
        />
      )}

      {dialog?.kind === 'toppings' && (
        <ToppingSheet
          product={dialog.product}
          toppings={selectableToppings(cat.toppings, menuId)}
          initial={dialog.initial}
          soldOut={soldOut}
          swapping={!!swapLine}
          onAdd={(ids) => addWithToppings(dialog.product, ids)}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'delete' && (
        <Sheet
          testId="delete-sheet"
          size="md"
          title={`Xóa đơn ${saved?.code ? `#${saved.code}` : ''}?`}
          subtitle="Chọn lý do để ghi vào nhật ký"
          icon={<IconTile icon={Trash2} className="h-11 w-11 rounded-xl" iconClass="h-[22px] w-[22px]" tone="bg-[#fdecec] text-[#dc2626]" />}
        >
          <div className="grid grid-cols-2 gap-2.5">
            {DELETE_REASONS.map((r) => (
              <button key={r.id} type="button" className={staffBtn('danger', 'md', 'min-h-[47px] px-2')} disabled={busy} onClick={() => void remove(r.id)} data-testid={`delete-reason-${r.id}`}>
                {r.label}
              </button>
            ))}
          </div>
          <button type="button" className={staffBtn('secondary', 'md', 'min-h-[47px] w-full')} onClick={() => setDialog(null)} data-testid="delete-cancel">
            Không xóa
          </button>
        </Sheet>
      )}

      {dialog?.kind === 'discard' && (
        <Sheet
          testId="discard-sheet"
          size="sm"
          title="Bỏ thay đổi?"
          subtitle={
            saved
              ? `Đơn ${saved.code} chưa lưu được (${noAddress ? 'thiếu địa chỉ giao' : noPayout ? 'chưa chọn tiền trả shipper' : 'không còn món'}). Rời đơn sẽ bỏ các thay đổi.`
              : `Đơn mới chưa lưu${itemCount > 0 ? ` có ${itemCount} món` : ''}. Rời đơn sẽ bỏ các thay đổi này.`
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" className={staffBtn('secondary', 'md', 'min-h-[47px]')} onClick={() => setDialog(null)} data-testid="discard-no">
              Ở lại
            </button>
            <button
              type="button"
              className={staffBtn('dangerSolid', 'md', 'min-h-[47px]')}
              onClick={() => {
                const go = dialog.go;
                setDialog(null);
                go();
              }}
              data-testid="discard-yes"
            >
              Bỏ thay đổi
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function ToppingSheet({
  product,
  toppings,
  initial,
  soldOut,
  swapping,
  onAdd,
  onCancel,
}: {
  product: Product;
  toppings: Topping[];
  initial: string[];
  /** Topping đang hết: không chọn thêm được (đã có sẵn trong món đang đổi thì vẫn bỏ được). */
  soldOut: SoldOutSet;
  /** Đang đổi món ⇒ nút xác nhận thay dòng đã chọn chứ không thêm dòng mới. */
  swapping: boolean;
  onAdd: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => initial.filter((id) => toppings.some((t) => t.id === id)));
  const price = product.price + toppings.filter((t) => picked.includes(t.id)).reduce((s, t) => s + t.price, 0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Sheet testId="topping-sheet" title={product.name} subtitle={`Chọn topping (có thể bỏ qua) · ${formatVnd(product.price)}`} onClose={onCancel}>
      <div className="grid grid-cols-2 gap-2.5 md:gap-3">
        {toppings.map((t) => {
          const on = picked.includes(t.id);
          const out = soldOut.topping(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              disabled={out && !on}
              data-sold-out={out || undefined}
              onClick={() => toggle(t.id)}
              className="btn btn-choice min-h-[64px] justify-between gap-2 px-3.5 text-left md:min-h-[68px]"
              data-testid={`topping-option-${t.id}`}
            >
              <span className="flex min-w-0 flex-col">
                <span className={`truncate text-base md:text-[17px] ${out ? 'line-through' : ''}`}>{t.name}</span>
                <span className="num text-sm font-normal opacity-80">{out ? 'Hết' : `+${formatVnd(t.price)}`}</span>
              </span>
              <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${on ? 'bg-brand-strong text-white' : 'border border-line-strong bg-surface'}`}>
                {on && <Check className="h-4 w-4" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-secondary min-h-[52px]" onClick={onCancel} data-testid="topping-cancel">
          Hủy
        </button>
        <button type="button" className="btn btn-primary min-h-[52px]" onClick={() => onAdd(picked)} data-testid="topping-add">
          {swapping ? <ArrowLeftRight aria-hidden className="h-5 w-5" /> : <Plus aria-hidden className="h-5 w-5" />}
          {swapping ? 'Đổi' : 'Thêm'} · {formatVnd(price)}
        </button>
      </div>
    </Sheet>
  );
}
