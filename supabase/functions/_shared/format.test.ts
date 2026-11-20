import { describe, expect, it } from 'vitest';
import { formatNotification, signed, vnd, type Notification, type Reconcile } from './format';

const opts = { appUrl: 'https://pos.laodai.vn/' };
// 05:42 giờ VN = 22:42Z hôm trước
const AT = '2026-11-17T22:42:00Z';
const base = { performed_at: AT, synced_at: '2026-11-17T22:42:03Z' };
const offline = { performed_at: AT, synced_at: '2026-11-18T00:10:00Z' };
const ctx = { shift_id: 's1', staff_name: 'Lan', tablet_name: 'Tablet A', opened_at: AT, closed_at: null };

const rec: Reconcile = {
  revenue: { total: 2_350_000, cash: 1_600_000, transfer: 650_000, debt: 100_000 },
  paid_orders: 80,
  debt_collected: { cash: 0, transfer: 0 },
  cash: { expected: 2_100_000, counted: 2_080_000, diff: -20_000 },
  boxes: { used: 118, by_orders: 112, diff: 6 },
  plates: { used: 0, by_orders: 0, diff: 0 },
  deleted_count: 2,
  deleted_after_served: [{ order_id: 'o9', code: 'F35', boxes: 2, plates: 0 }],
  open_orders: 1,
};

const order = {
  id: 'o1', code: 'F35', total: 62_000, status: 'served', dine_type: 'takeaway', label: null, table_no: null,
  payment_method: 'cash', customer_id: null,
  items: [{ name_snap: 'Xôi gà', qty: 2, unit_price_snap: 25_000, toppings_snap: [{ name: 'Trứng', price: 6_000 }] }],
};

const samples: Notification[] = [
  { kind: 'tablet_login', payload: { ...base, tablet_name: 'Tablet A' } },
  { kind: 'owner_mode', payload: { ...base, tablet_name: 'Tablet A' } },
  { kind: 'shift_open', payload: { ...base, ...ctx } },
  { kind: 'shift_close', payload: { ...base, ...ctx, closed_at: '2026-11-18T03:15:00Z', reconcile: rec, adjusted: false } },
  { kind: 'order_deleted', payload: { ...base, ...ctx, order, reason: 'customer_left', was_served: true } },
  {
    kind: 'delivery_order',
    payload: { ...base, ...ctx, order: { ...order, status: 'open', dine_type: 'delivery', address: '12 Lê Lợi, P.3 – 0909 123 456' }, point_name: 'Xôi A', updated: false },
  },
  {
    kind: 'debt_recorded',
    payload: { ...base, ...ctx, order_code: 'K72', order_id: 'o2', customer_id: 'c1', amount: 35_000, customer_label: 'Dũng (giáo viên)', balance: 120_000 },
  },
  {
    kind: 'debt_paid',
    payload: { ...base, ...ctx, customer_id: 'c1', customer_label: 'Dũng (giáo viên)', amount: 50_000, method: 'cash', balance: 70_000 },
  },
  {
    kind: 'owner_edit',
    payload: {
      ...base, order_id: 'o1', order_code: 'F35', tablet_name: 'Tablet A',
      before: { ...order, status: 'paid' },
      after: { ...order, status: 'paid', payment_method: 'transfer' },
      recalculated: { before: { s1: rec }, after: { s1: { ...rec, cash: { expected: 2_038_000, counted: 2_080_000, diff: 42_000 } } } },
    },
  },
  { kind: 'seq_gap', payload: { ...offline, tablet_name: 'Tablet A', missing: [3], received: 4 } },
  { kind: 'sync_rejected', payload: { ...base, tablet_name: 'Tablet B', kind: 'create_order', reason: 'total_mismatch' } },
  {
    kind: 'daily_summary',
    payload: {
      ...base, date: '2026-11-18',
      revenue: { total: 3_350_000, cash: 2_100_000, transfer: 1_150_000, debt: 100_000 },
      by_point: [{ point_name: 'Xôi A', total: 1_200_000 }, { point_name: 'Xôi B', total: 1_000_000 }, { point_name: 'Cơm gà', total: 1_150_000 }],
      debt_collected: 50_000,
      deleted: { count: 3, served: 1 },
      shifts: [
        { ...ctx, status: 'closed', reconcile: rec },
        { ...ctx, staff_name: 'Mai', tablet_name: 'Tablet B', status: 'open', reconcile: { ...rec, cash: { expected: 300_000, counted: null, diff: null }, boxes: { used: null, by_orders: 5, diff: null } } },
      ],
      open_orders: 1,
      unresolved_gaps: 1,
    },
  },
];

describe('định dạng Telegram', () => {
  it.each(samples.map((s) => [s.kind, s] as const))('%s', (_k, n) => {
    expect(formatNotification(n, opts)).toMatchSnapshot();
  });

  it('có đủ snapshot cho mọi loại tin của đặc tả', () => {
    expect(new Set(samples.map((s) => s.kind))).toEqual(
      new Set(['tablet_login', 'owner_mode', 'shift_open', 'shift_close', 'order_deleted', 'delivery_order', 'debt_recorded', 'debt_paid',
        'owner_edit', 'seq_gap', 'sync_rejected', 'daily_summary']),
    );
  });

  it('tiền định dạng kiểu 1.600.000', () => {
    expect(vnd(1_600_000)).toBe('1.600.000');
    expect(signed(-20_000)).toBe('−20.000');
    expect(signed(6, false)).toBe('+6');
    expect(signed(null)).toBe('?');
    const msg = formatNotification(samples[3], opts);
    expect(msg).toContain('TM 1.600.000');
    expect(msg).toContain('đếm 2.080.000 / kỳ vọng 2.100.000 → −20.000');
    expect(msg).toContain('Hộp: dùng 118 / theo đơn 112 → +6');
  });

  it('thao tác lúc offline hiện cả thời điểm thực hiện và đồng bộ', () => {
    const online = formatNotification({ kind: 'shift_open', payload: { ...base, ...ctx } }, opts);
    expect(online).not.toContain('Đồng bộ');
    const off = formatNotification({ kind: 'shift_open', payload: { ...offline, ...ctx } }, opts);
    expect(off).toContain('Thực hiện: 05:42 · Đồng bộ: 07:10');
    const nextDay = formatNotification({ kind: 'shift_open', payload: { ...ctx, performed_at: AT, synced_at: '2026-11-19T01:00:00Z' } }, opts);
    expect(nextDay).toContain('Thực hiện: 05:42 18/11 · Đồng bộ: 08:00 19/11');
  });

  it('đơn ship có chọn khách: hiện tên + SĐT khách trên địa chỉ', () => {
    const msg = formatNotification(
      {
        kind: 'delivery_order',
        payload: {
          ...base, ...ctx, order: { ...order, status: 'open', dine_type: 'delivery', address: '12 Lê Lợi' }, point_name: 'Xôi A',
          customer: { id: 'c1', label: 'Dũng (giáo viên)', phone: '0909 123 456' }, updated: false,
        },
      },
      opts,
    );
    expect(msg).toContain('👤 Dũng (giáo viên) – 0909 123 456\n📍 12 Lê Lợi');
  });

  it('mỗi tin có link mở thẳng chi tiết trong app chủ', () => {
    for (const s of samples) expect(formatNotification(s, opts)).toMatch(/🔗 https:\/\/pos\.laodai\.vn\/owner\/\S+$/);
  });

  it('ca chưa đếm / không chênh lệch', () => {
    const r: Reconcile = { ...rec, cash: { expected: 500_000, counted: null, diff: null }, deleted_after_served: [], deleted_count: 0,
      boxes: { used: null, by_orders: 3, diff: null }, debt_collected: { cash: 50_000, transfer: 0 } };
    const msg = formatNotification({ kind: 'shift_close', payload: { ...base, ...ctx, reconcile: r, adjusted: true } }, opts);
    expect(msg).toContain('🟢 Đóng ca');
    expect(msg).toContain('đã điều chỉnh');
    expect(msg).toContain('kỳ vọng 500.000 (chưa đếm)');
    expect(msg).toContain('Hộp: dùng ? / theo đơn 3');
    expect(msg).toContain('Thu nợ: TM 50.000 · CK 0');
  });
});
