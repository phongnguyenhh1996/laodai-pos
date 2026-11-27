import { describe, expect, it } from 'vitest';
import { formatNotification, signed, vnd, type Notification } from './format';
import type { StoredReconcile } from './reconcile';

const opts = { appUrl: 'https://pos.laodai.vn/' };
// 05:42 giờ VN = 22:42Z hôm trước
const AT = '2026-11-17T22:42:00Z';
const base = { performed_at: AT, synced_at: '2026-11-17T22:42:03Z' };
const offline = { performed_at: AT, synced_at: '2026-11-18T00:10:00Z' };
const ctx = { shift_id: 's1', staff_name: 'Lan', tablet_name: 'Tablet A', opened_at: AT, closed_at: null };

const rec: StoredReconcile = {
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

const exp = { id: 'e1', shift_id: 's1', amount: 20_000, note: 'mua đá', actor_kind: 'staff' as const };

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
  { kind: 'backup_failed', payload: { ...base, date: '2026-11-23', attempts: 2, error: 'Telegram 400: chat not found' } },
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
  // Shipper ngoài (SPEC 4.2 / 6): tin đơn ship + báo cáo ca có thống kê ship.
  {
    kind: 'delivery_order',
    payload: {
      ...base, ...ctx, point_name: 'Xôi A', updated: false,
      order: { ...order, status: 'open', dine_type: 'delivery', address: '12 Lê Lợi', ship_mode: 'external', ship_fee: 5_000, ship_payout: 10_000, total: 67_000 },
    },
  },
  {
    kind: 'shift_close',
    payload: {
      ...base, ...ctx, closed_at: '2026-11-18T03:15:00Z', adjusted: false,
      reconcile: { ...rec, ship: { shop_orders: 2, external_orders: 3, shop_fee: 20_000, external_fee: 15_000, payout: 30_000, external_profit: -15_000 } },
    },
  },
  // Khoản chi (SPEC 4.9 / 6).
  { kind: 'expense_created', payload: { ...base, ...ctx, expense: exp, actor: 'staff', before: null, recalculated: null } },
  { kind: 'expense_voided', payload: { ...base, ...ctx, expense: exp, actor: 'staff', before: null, recalculated: null } },
  {
    kind: 'expense_edited',
    payload: {
      ...base, ...ctx, expense: { ...exp, amount: 25_000 }, actor: 'owner', before: exp,
      recalculated: { before: { ...rec, cash: { expected: 2_100_000, counted: 2_080_000, diff: -20_000 } }, after: { ...rec, cash: { expected: 2_095_000, counted: 2_080_000, diff: -15_000 } } },
    },
  },
  {
    kind: 'shift_close',
    payload: { ...base, ...ctx, closed_at: '2026-11-18T03:15:00Z', adjusted: false, reconcile: { ...rec, expenses: { count: 3, total: 120_000 } } },
  },
];

describe('định dạng Telegram', () => {
  it.each(samples.map((s) => [s.kind, s] as const))('%s', (_k, n) => {
    expect(formatNotification(n, opts)).toMatchSnapshot();
  });

  it('có đủ snapshot cho mọi loại tin của đặc tả', () => {
    expect(new Set(samples.map((s) => s.kind))).toEqual(
      new Set(['tablet_login', 'owner_mode', 'shift_open', 'shift_close', 'order_deleted', 'delivery_order', 'debt_recorded', 'debt_paid',
        'owner_edit', 'seq_gap', 'sync_rejected', 'daily_summary', 'backup_failed', 'expense_created', 'expense_voided', 'expense_edited']),
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

  it('phí ship: đơn ship có dòng "Phí ship" trước Tổng; báo cáo ca có "Trong đó phí ship"', () => {
    const msg = formatNotification(
      {
        kind: 'delivery_order',
        payload: {
          ...base, ...ctx, order: { ...order, status: 'open', dine_type: 'delivery', address: '12 Lê Lợi', ship_fee: 10_000, total: 72_000 },
          point_name: 'Xôi A', updated: false,
        },
      },
      opts,
    );
    expect(msg).toContain('Quán ship · phí ship 10.000\nTổng: 72.000');
    const close = formatNotification(
      { kind: 'shift_close', payload: { ...base, ...ctx, reconcile: { ...rec, revenue: { ...rec.revenue, ship_fee: 25_000 } }, adjusted: false } },
      opts,
    );
    expect(close).toContain('Nợ 100.000)\nTrong đó phí ship: 25.000');
    expect(formatNotification(samples[3]!, opts)).not.toContain('Trong đó phí ship');
  });

  it('shipper ngoài: tin đơn ship ghi kiểu + phụ thu + trả shipper; báo cáo ca có dòng ship ngoài; chủ đổi kiểu / trả shipper có dòng Ship', () => {
    const ext = { ...order, status: 'open', dine_type: 'delivery', address: '12 Lê Lợi', ship_mode: 'external', ship_fee: 5_000, ship_payout: 10_000, total: 67_000 };
    const msg = formatNotification({ kind: 'delivery_order', payload: { ...base, ...ctx, order: ext, point_name: 'Xôi A', updated: true } }, opts);
    expect(msg).toContain('🛵 Cập nhật đơn ship');
    expect(msg).toContain('Shipper ngoài · phụ thu 5.000 · trả shipper 10.000\nTổng: 67.000');
    expect(formatNotification({ kind: 'delivery_order', payload: { ...base, ...ctx, order: { ...ext, ship_fee: 0 }, point_name: null, updated: false } }, opts))
      .toContain('Shipper ngoài · không phụ thu · trả shipper 10.000');

    const ship = { shop_orders: 1, external_orders: 3, shop_fee: 10_000, external_fee: 15_000, payout: 30_000, external_profit: -15_000 };
    const close = formatNotification(
      { kind: 'shift_close', payload: { ...base, ...ctx, reconcile: { ...rec, revenue: { ...rec.revenue, ship_fee: 25_000 }, ship }, adjusted: false } },
      opts,
    );
    expect(close).toContain('Nợ 100.000)\nTrong đó phí ship: 10.000\nShip ngoài: 3 đơn · phụ thu 15.000 · trả 30.000 → −15.000');

    const edit = formatNotification(
      {
        kind: 'owner_edit',
        payload: {
          ...base, order_id: 'o1', order_code: 'A30', tablet_name: 'Quầy A',
          before: { ...ext, status: 'paid', payment_method: 'cash' }, after: { ...ext, status: 'paid', payment_method: 'cash', ship_payout: 15_000 },
          recalculated: { before: {}, after: {} },
        },
      } as Notification,
      opts,
    );
    expect(edit).toContain('Ship: Shipper ngoài · phụ thu 5.000 · trả shipper 10.000 → Shipper ngoài · phụ thu 5.000 · trả shipper 15.000');
    const same = formatNotification(
      { kind: 'owner_edit', payload: { ...base, order_id: 'o1', order_code: 'A30', tablet_name: 'Quầy A', before: { ...ext, status: 'paid' }, after: { ...ext, status: 'paid' }, recalculated: { before: {}, after: {} } } } as Notification,
      opts,
    );
    expect(same).not.toContain('Ship:');
  });

  it('mỗi tin có link mở thẳng chi tiết trong app chủ', () => {
    for (const s of samples) expect(formatNotification(s, opts)).toMatch(/🔗 https:\/\/pos\.laodai\.vn\/owner\/\S+$/);
  });

  it('ca chưa đếm / không chênh lệch', () => {
    const r: StoredReconcile = { ...rec, cash: { expected: 500_000, counted: null, diff: null }, deleted_after_served: [], deleted_count: 0,
      boxes: { used: null, by_orders: 3, diff: null }, debt_collected: { cash: 50_000, transfer: 0 } };
    const msg = formatNotification({ kind: 'shift_close', payload: { ...base, ...ctx, reconcile: r, adjusted: true } }, opts);
    expect(msg).toContain('🟢 Đóng ca');
    expect(msg).toContain('đã điều chỉnh');
    expect(msg).toContain('kỳ vọng 500.000 (chưa đếm)');
    expect(msg).toContain('Hộp: dùng ? / theo đơn 3');
    expect(msg).toContain('Thu nợ: TM 50.000 · CK 0');
  });

  it('khoản chi: tin ghi / hủy / chủ sửa theo SPEC 6; báo cáo ca + tổng kết ngày có dòng "Chi" chỉ khi có khoản chi', () => {
    const fmt = (n: Notification) => formatNotification(n, opts).split('\n');
    const p = { ...base, ...ctx, expense: exp, actor: 'staff' as const, before: null, recalculated: null };
    expect(fmt({ kind: 'expense_created', payload: p })[0]).toBe('💸 Chi 20.000 – mua đá · Lan · Tablet A');
    expect(fmt({ kind: 'expense_voided', payload: p })[0]).toBe('↩️ Hủy chi 20.000 – mua đá · Lan');
    expect(fmt({ kind: 'expense_voided', payload: { ...p, actor: 'owner' } })[0]).toBe('↩️ Hủy chi 20.000 – mua đá · Lan (chủ)');
    expect(fmt({ kind: 'expense_created', payload: p }).at(-1)).toBe('🔗 https://pos.laodai.vn/owner/shifts/s1');
    const edit = fmt(samples.find((s) => s.kind === 'expense_edited')!);
    expect(edit[0]).toBe('✏️ Sửa chi: 20.000 – mua đá → 25.000 – mua đá · Lan · Tablet A (chủ)');
    expect(edit[1]).toBe('Ca đã đóng → đã tính lại: tiền mặt −20.000 → −15.000');

    const close = (r: StoredReconcile) => formatNotification({ kind: 'shift_close', payload: { ...base, ...ctx, reconcile: r, adjusted: false } }, opts);
    expect(close({ ...rec, expenses: { count: 3, total: 120_000 } })).toContain('Dĩa: dùng 0 / theo đơn 0\nChi: 3 khoản · 120.000\nXóa:');
    expect(close({ ...rec, expenses: { count: 0, total: 0 } })).not.toContain('Chi:');
    expect(close(rec)).not.toContain('Chi:');
    const day = samples.find((s) => s.kind === 'daily_summary')!.payload as object;
    expect(formatNotification({ kind: 'daily_summary', payload: { ...day, expenses: { count: 2, total: 50_000 } } } as Notification, opts)).toContain('Chi: 2 khoản · 50.000');
    expect(formatNotification({ kind: 'daily_summary', payload: day } as Notification, opts)).not.toContain('Chi:');
  });

  it('quầy chỉ đếm lon: không nhắc tiền mặt / hộp / dĩa; bao bì đơn xóa ghi lon', () => {
    const r: StoredReconcile = {
      ...rec, count_items: ['cans'], cash: { expected: 275_000, counted: null, diff: null },
      boxes: { used: null, by_orders: 1, diff: null }, plates: { used: null, by_orders: 0, diff: null },
      cans: { used: 6, by_orders: 5, diff: 1 },
      deleted_after_served: [{ order_id: 'o9', code: 'H23', boxes: 0, plates: 0, cans: 1 }],
    };
    const msg = formatNotification({ kind: 'shift_close', payload: { ...base, ...ctx, reconcile: r, adjusted: false } }, opts);
    expect(msg).toContain('Lon: dùng 6 / theo đơn 5 → +1');
    expect(msg).toContain('H23 (1 lon)');
    expect(msg).not.toMatch(/Tiền mặt|Hộp:|Dĩa:/);
    const day = formatNotification(
      { kind: 'daily_summary', payload: { ...(samples.find((s) => s.kind === 'daily_summary')!.payload as object), shifts: [{ ...ctx, status: 'closed', reconcile: r }] } } as Notification,
      opts,
    );
    expect(day).toContain('• Lan – Tablet A: Lon +1');
  });
});
