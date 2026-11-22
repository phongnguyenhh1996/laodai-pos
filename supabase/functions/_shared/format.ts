// Định dạng tin Telegram. Thuần TS, không phụ thuộc Deno/Node ⇒ dùng chung cho Edge Function và Vitest.

export const TZ = 'Asia/Ho_Chi_Minh';
const MINUS = '−';

export function vnd(n: number): string {
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? MINUS + s : s;
}

export function signed(n: number | null | undefined, money = true): string {
  if (n === null || n === undefined) return '?';
  const body = money ? vnd(Math.abs(n)) : String(Math.abs(n));
  return n > 0 ? '+' + body : n < 0 ? MINUS + body : body;
}

export function hhmm(at: string | Date, tz = TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(at),
  );
}

export function ddmm(at: string | Date, tz = TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(new Date(at));
}

export function ddmmyyyy(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------- kiểu payload (khớp các private.notify trong SQL)

interface Base {
  performed_at: string;
  synced_at: string;
}

interface ShiftCtx {
  shift_id?: string;
  staff_name: string | null;
  tablet_name: string | null;
  opened_at?: string;
  closed_at?: string | null;
}

interface ItemSnap {
  name_snap: string;
  qty: number;
  unit_price_snap: number;
  toppings_snap: Array<{ name: string; price: number }>;
}

interface OrderSnap {
  id: string;
  code: string;
  total: number;
  /** Phí ship (đã nằm trong `total`); bản ghi cũ không có. */
  ship_fee?: number;
  status: string;
  dine_type: string;
  label: string | null;
  table_no: string | null;
  address?: string | null;
  payment_method: string | null;
  customer_id: string | null;
  items: ItemSnap[];
}

interface CountLine {
  used: number | null;
  by_orders: number;
  diff: number | null;
}

interface Revenue {
  total: number;
  cash: number;
  transfer: number;
  debt: number;
  /** Phần phí ship nằm trong `total` (bản ghi cũ không có). */
  ship_fee?: number;
}

export type CountItem = 'cash' | 'boxes' | 'plates' | 'cans';

export interface Reconcile {
  /** Các thứ ca này đếm (bản ghi cũ không có ⇒ tiền mặt, hộp, dĩa). Thứ không đếm thì không nhắc tới. */
  count_items?: CountItem[];
  revenue: Revenue;
  paid_orders: number;
  debt_collected: { cash: number; transfer: number };
  cash: { expected: number; counted: number | null; diff: number | null };
  boxes: CountLine;
  plates: CountLine;
  /** Bản ghi cũ không có. */
  cans?: CountLine;
  deleted_count: number;
  deleted_after_served: Array<{ order_id: string; code: string; boxes: number; plates: number; cans?: number }>;
  open_orders: number;
}

export type Notification =
  | { kind: 'tablet_login'; payload: Base & { tablet_name: string } }
  | { kind: 'owner_mode'; payload: Base & { tablet_name: string } }
  | { kind: 'shift_open'; payload: Base & ShiftCtx }
  | { kind: 'shift_close'; payload: Base & ShiftCtx & { reconcile: Reconcile; adjusted: boolean } }
  | { kind: 'order_deleted'; payload: Base & ShiftCtx & { order: OrderSnap; reason: string; was_served: boolean } }
  | {
      kind: 'delivery_order';
      payload: Base &
        ShiftCtx & {
          order: OrderSnap;
          point_name: string | null;
          /** Khách đã chọn cho đơn ship (không chọn ⇒ null / không có). */
          customer?: { id: string; label: string; phone: string | null } | null;
          updated: boolean;
        };
    }
  | {
      kind: 'debt_recorded';
      payload: Base &
        ShiftCtx & { order_code: string; order_id: string; customer_id: string; amount: number; customer_label: string; balance: number };
    }
  | {
      kind: 'debt_paid';
      payload: Base & ShiftCtx & { customer_id: string; customer_label: string; amount: number; method: string; balance: number };
    }
  | {
      kind: 'owner_edit';
      payload: Base & {
        order_id: string;
        order_code: string;
        tablet_name: string;
        before: OrderSnap;
        after: OrderSnap;
        recalculated: { before: Record<string, Reconcile>; after: Record<string, Reconcile> };
      };
    }
  | { kind: 'seq_gap'; payload: Base & { tablet_name: string; missing: number[]; received: number } }
  | { kind: 'sync_rejected'; payload: Base & { tablet_name: string; kind: string; reason: string } }
  | { kind: 'backup_failed'; payload: Base & { date: string; attempts: number; error: string } }
  | {
      kind: 'daily_summary';
      payload: Base & {
        date: string;
        revenue: Revenue;
        by_point: Array<{ point_name: string; total: number }>;
        debt_collected: number;
        deleted: { count: number; served: number };
        shifts: Array<ShiftCtx & { status: string; reconcile: Reconcile }>;
        open_orders: number;
        unresolved_gaps: number;
      };
    };

export type NotificationKind = Notification['kind'];

// ---------------------------------------------------------------- tiện ích nội dung

const REASONS: Record<string, string> = {
  mistake: 'Bấm nhầm',
  customer_left: 'Khách bỏ về',
  customer_changed: 'Khách đổi ý',
  other: 'Khác',
};

const METHODS: Record<string, string> = { cash: 'TM', transfer: 'CK', debt: 'Nợ' };

const REJECT_REASONS: Record<string, string> = {
  total_mismatch: 'tổng tiền không khớp giá menu',
  price_mismatch: 'giá món không khớp menu',
  shift_already_open: 'tablet đã có ca mở',
  order_not_open: 'đơn không còn mở',
  point_not_allowed: 'điểm bán không thuộc tablet',
  address_required: 'đơn ship thiếu địa chỉ',
};

function itemLine(it: ItemSnap): string {
  const tops = it.toppings_snap.length ? ` (+${it.toppings_snap.map((t) => t.name).join(', +')})` : '';
  const line = (it.unit_price_snap + it.toppings_snap.reduce((s, t) => s + t.price, 0)) * it.qty;
  return `• ${it.qty}× ${it.name_snap}${tops} — ${vnd(line)}`;
}

function who(p: ShiftCtx): string {
  return [p.staff_name, p.tablet_name].filter(Boolean).join(' – ');
}

/** Thao tác thực hiện lúc offline (đồng bộ trễ ≥ 2 phút) ⇒ ghi rõ cả hai thời điểm. */
function timing(p: Base): string {
  const lag = new Date(p.synced_at).getTime() - new Date(p.performed_at).getTime();
  if (lag >= 2 * 60_000) {
    const sameDay = ddmm(p.performed_at) === ddmm(p.synced_at);
    const fmt = (t: string) => (sameDay ? hhmm(t) : `${hhmm(t)} ${ddmm(t)}`);
    return `⏱ Thực hiện: ${fmt(p.performed_at)} · Đồng bộ: ${fmt(p.synced_at)} (offline)`;
  }
  return '';
}

function countLine(label: string, c: CountLine): string {
  const used = c.used === null ? '?' : String(c.used);
  const diff = c.diff === null || c.diff === 0 ? '' : ` → ${signed(c.diff, false)}`;
  return `${label}: dùng ${used} / theo đơn ${c.by_orders}${diff}`;
}

function revenueLines(r: Revenue): string[] {
  return [
    `Doanh thu: ${vnd(r.total)} (TM ${vnd(r.cash)} · CK ${vnd(r.transfer)} · Nợ ${vnd(r.debt)})`,
    ...(r.ship_fee ? [`Trong đó phí ship: ${vnd(r.ship_fee)}`] : []),
  ];
}

const PACKS = [
  ['boxes', 'Hộp', 'hộp'],
  ['plates', 'Dĩa', 'dĩa'],
  ['cans', 'Lon', 'lon'],
] as const;

const counts = (r: Reconcile): CountItem[] => r.count_items ?? ['cash', 'boxes', 'plates'];
/** Bao bì ca này đếm, theo thứ tự Hộp · Dĩa · Lon. */
const countedPacks = (r: Reconcile) => PACKS.filter(([k]) => counts(r).includes(k) && r[k]);

export function shiftReport(r: Reconcile): string[] {
  const served = r.deleted_after_served.length;
  const lines = [
    ...revenueLines(r.revenue),
  ];
  if (r.debt_collected.cash || r.debt_collected.transfer) {
    lines.push(`Thu nợ: TM ${vnd(r.debt_collected.cash)} · CK ${vnd(r.debt_collected.transfer)}`);
  }
  if (counts(r).includes('cash')) {
    lines.push(
      r.cash.counted === null
        ? `Tiền mặt: kỳ vọng ${vnd(r.cash.expected)} (chưa đếm)`
        : `Tiền mặt: đếm ${vnd(r.cash.counted)} / kỳ vọng ${vnd(r.cash.expected)} → ${signed(r.cash.diff)}`,
    );
  }
  lines.push(...countedPacks(r).map(([k, label]) => countLine(label, r[k]!)));
  lines.push(`Xóa: ${r.deleted_count} đơn (${served} đã ra món) · Đơn còn mở: ${r.open_orders}`);
  if (served) {
    lines.push(
      `Bao bì của đơn bị xóa sau khi ra món: ${r.deleted_after_served
        .map((d) => `${d.code} (${packList(d)})`)
        .join(', ')}`,
    );
  }
  return lines;
}

/** "3 hộp, 1 lon": chỉ ghi thứ có; không có gì ⇒ "0 hộp". */
export function packList(d: { boxes: number; plates: number; cans?: number }): string {
  const parts = PACKS.filter(([k]) => (d[k] ?? 0) > 0).map(([k, , unit]) => `${d[k]} ${unit}`);
  return parts.join(', ') || '0 hộp';
}

function shiftIcon(r: Reconcile): string {
  const bad = (r.cash.diff ?? 0) !== 0 || r.deleted_after_served.length > 0;
  return bad ? '🔴' : '🟢';
}

// ---------------------------------------------------------------- định dạng chính

export interface FormatOptions {
  appUrl: string;
}

export function formatNotification(n: Notification, opts: FormatOptions): string {
  const app = opts.appUrl.replace(/\/$/, '');
  const p = n.payload;
  let lines: string[];
  let link: string;

  switch (n.kind) {
    case 'tablet_login':
      lines = [`🔐 ${n.payload.tablet_name} vừa được đăng nhập – ${hhmm(p.performed_at)}`];
      link = `${app}/owner/log?action=tablet_login`;
      break;
    case 'owner_mode':
      lines = [`👑 Vào chế độ chủ trên ${n.payload.tablet_name} – ${hhmm(p.performed_at)}`];
      link = `${app}/owner/log?action=owner_mode`;
      break;
    case 'shift_open':
      lines = [`🟢 ${n.payload.staff_name} mở ca – ${n.payload.tablet_name} – ${hhmm(n.payload.opened_at ?? p.performed_at)}`];
      link = `${app}/owner/shifts/${n.payload.shift_id}`;
      break;
    case 'shift_close': {
      const q = n.payload;
      const range = `${hhmm(q.opened_at!)}–${hhmm(q.closed_at ?? p.performed_at)}`;
      lines = [
        `${shiftIcon(q.reconcile)} Đóng ca – ${who(q)} (${range})${q.adjusted ? ' · đã điều chỉnh' : ''}`,
        ...shiftReport(q.reconcile),
      ];
      link = `${app}/owner/shifts/${q.shift_id}`;
      break;
    }
    case 'order_deleted': {
      const q = n.payload;
      lines = [
        `🗑 Xóa đơn ${q.order.code} – ${who(q)}`,
        `Lý do: ${REASONS[q.reason] ?? q.reason}`,
        `Trạng thái lúc xóa: ${q.was_served ? '⚠️ ĐÃ RA MÓN' : 'chưa ra món'}`,
        ...q.order.items.map(itemLine),
        `Tổng: ${vnd(q.order.total)}`,
      ];
      link = `${app}/owner/orders/${q.order.id}`;
      break;
    }
    case 'delivery_order': {
      const q = n.payload;
      const head = q.updated ? 'Cập nhật đơn ship' : 'Đơn ship mới';
      lines = [
        `🛵 ${head} #${q.order.code}${q.point_name ? ` – ${q.point_name}` : ''}`,
        ...(q.customer ? [`👤 ${q.customer.label}${q.customer.phone ? ` – ${q.customer.phone}` : ''}`] : []),
        `📍 ${q.order.address ?? '(chưa có địa chỉ)'}`,
        ...(q.order.label ? [`Nhãn: ${q.order.label}`] : []),
        ...q.order.items.map(itemLine),
        ...(q.order.ship_fee ? [`Phí ship: ${vnd(q.order.ship_fee)}`] : []),
        `Tổng: ${vnd(q.order.total)}`,
        ...(who(q) ? [who(q)] : []),
      ];
      link = `${app}/owner/orders/${q.order.id}`;
      break;
    }
    case 'debt_recorded': {
      const q = n.payload;
      lines = [
        `📒 Ghi nợ ${vnd(q.amount)} – ${q.customer_label}`,
        `Đơn ${q.order_code} – ${who(q)}`,
        `Dư nợ: ${vnd(q.balance)}`,
      ];
      link = `${app}/owner/debts/${q.customer_id}`;
      break;
    }
    case 'debt_paid': {
      const q = n.payload;
      lines = [
        `💵 Thu nợ ${vnd(q.amount)} (${METHODS[q.method] ?? q.method}) – ${q.customer_label}`,
        ...(who(q) ? [who(q)] : []),
        `Dư nợ còn: ${vnd(q.balance)}`,
      ];
      link = `${app}/owner/debts/${q.customer_id}`;
      break;
    }
    case 'owner_edit': {
      const q = n.payload;
      const pm = (o: OrderSnap) => METHODS[o.payment_method ?? ''] ?? '-';
      lines = [
        `✏️ Chủ sửa đơn ${q.order_code} (đã thanh toán) – ${q.tablet_name}`,
        `Trước: ${vnd(q.before.total)} · ${pm(q.before)}`,
        ...q.before.items.map(itemLine),
        `Sau: ${vnd(q.after.total)} · ${pm(q.after)}`,
        ...q.after.items.map(itemLine),
      ];
      for (const sid of Object.keys(q.recalculated.after)) {
        const b = q.recalculated.before[sid];
        const a = q.recalculated.after[sid];
        lines.push(`Ca đã đóng → đã tính lại: tiền mặt ${signed(b?.cash.diff)} → ${signed(a.cash.diff)}`);
      }
      link = `${app}/owner/orders/${q.order_id}`;
      break;
    }
    case 'backup_failed': {
      const q = n.payload;
      lines = [
        `⚠️ Sao lưu đêm ${ddmmyyyy(q.date)} không gửi được${q.attempts ? ` (đã thử ${q.attempts} lần)` : ''}`,
        `Lỗi: ${q.error}`,
        'Xem log Edge Function nightly-backup trên Supabase.',
      ];
      link = `${app}/owner/settings`;
      break;
    }
    case 'seq_gap': {
      const q = n.payload;
      lines = [
        `⚠️ ${q.tablet_name}: thiếu đơn số ${q.missing.join(', ')} (nhận được số ${q.received})`,
        'Có thể dữ liệu trên tablet đã bị xóa trước khi đồng bộ.',
      ];
      link = `${app}/owner/log?action=seq_gap`;
      break;
    }
    case 'sync_rejected': {
      const q = n.payload;
      lines = [`⛔ ${q.tablet_name} gửi thao tác bị từ chối (${q.kind}): ${REJECT_REASONS[q.reason] ?? q.reason}`];
      link = `${app}/owner/log?action=sync_rejected`;
      break;
    }
    case 'daily_summary': {
      const q = n.payload;
      lines = [
        `📊 Tổng kết ngày ${ddmmyyyy(q.date)}`,
        ...revenueLines(q.revenue),
        ...q.by_point.map((b) => `• ${b.point_name}: ${vnd(b.total)}`),
      ];
      if (q.debt_collected) lines.push(`Thu nợ: ${vnd(q.debt_collected)}`);
      lines.push(`Xóa: ${q.deleted.count} đơn (${q.deleted.served} đã ra món)`);
      if (q.shifts.length) {
        lines.push('Ca:');
        for (const s of q.shifts) {
          const r = s.reconcile;
          const parts = [
            s.status === 'open' ? 'đang mở' : counts(r).includes('cash') ? `TM ${signed(r.cash.diff)}` : '',
            ...countedPacks(r).map(([k, label]) => `${label} ${signed(r[k]!.diff, false)}`),
          ].filter(Boolean);
          lines.push(`• ${who(s)}: ${parts.join(' · ')}`);
        }
      }
      if (q.open_orders) lines.push(`Đơn còn mở: ${q.open_orders}`);
      if (q.unresolved_gaps) lines.push(`⚠️ Lỗ hổng số đơn chưa giải quyết: ${q.unresolved_gaps}`);
      link = `${app}/owner/reports?date=${q.date}`;
      break;
    }
  }

  const t = n.kind === 'daily_summary' || n.kind === 'backup_failed' ? '' : timing(p);
  return [...lines, ...(t ? [t] : []), `🔗 ${link}`].join('\n');
}
