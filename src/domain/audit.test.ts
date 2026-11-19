import { describe, expect, it } from 'vitest';
import { ACTION_GROUPS, actionLabel, actionsForFilter, describeAudit } from './audit';

const item = (qty: number, name = 'Xôi gà', tops: string[] = []) => ({
  id: `${name}${qty}`, product_id: 'p', name_snap: name, unit_price_snap: 25_000, qty,
  toppings_snap: tops.map((t) => ({ id: t, name: t, price: 6_000, extra_box: false })),
});
const order = (o: Record<string, unknown> = {}) => ({
  code: '3F5', status: 'served', total: 62_000, dine_type: 'takeaway', label: null, payment_method: null,
  customer_id: null, items: [item(2, 'Xôi gà', ['Trứng'])], ...o,
});

describe('nhật ký', () => {
  it('nhãn tiếng Việt cho mọi action server ghi; action lạ giữ nguyên', () => {
    for (const a of ['order_update', 'order_delete', 'seq_gap', 'sync_rejected', 'tablet_login', 'owner_mode', 'settings_update']) {
      expect(actionLabel(a)).not.toBe(a);
    }
    expect(actionLabel('xyz')).toBe('xyz');
  });

  it('bộ lọc loại: nhóm → nhiều action; tên action (link Telegram) → đúng action đó; trống → không lọc', () => {
    expect(actionsForFilter('edits')).toEqual(['order_update', 'order_delete', 'owner_edit_order']);
    expect(actionsForFilter('seq_gap')).toEqual(['seq_gap']);
    expect(actionsForFilter('')).toBeNull();
    expect(actionsForFilter(undefined)).toBeNull();
    expect(new Set(ACTION_GROUPS.map((g) => g.id)).size).toBe(ACTION_GROUPS.length);
  });

  it('E22: bớt món sau khi ra món ⇒ trước / sau của món và tổng tiền', () => {
    const lines = describeAudit({
      action: 'order_update', entity: 'order', reason: null,
      before: order(), after: order({ total: 31_000, items: [item(1, 'Xôi gà', ['Trứng'])] }),
    });
    expect(lines).toEqual(['Món: 2× Xôi gà (Trứng) → 1× Xôi gà (Trứng)', 'Tổng: 62.000 → 31.000']);
  });

  it('E21: xóa đơn đã ra món ⇒ lý do + trạng thái lúc xóa + nội dung đơn', () => {
    const lines = describeAudit({
      action: 'order_delete', entity: 'order', reason: 'customer_left',
      before: order(), after: order({ status: 'deleted' }),
    });
    expect(lines[0]).toBe('Lý do: Khách bỏ về · lúc xóa ⚠️ ĐÃ RA MÓN');
    expect(lines).toContain('Trạng thái: đã ra món → đã xóa');
    expect(lines.at(-1)).toBe('2× Xôi gà (Trứng) · 62.000');
    expect(describeAudit({ action: 'order_delete', entity: 'order', reason: 'mistake', before: order({ status: 'open' }), after: null })[0]).toBe(
      'Lý do: Bấm nhầm · lúc xóa chưa ra món',
    );
  });

  it('tạo / ra món / thanh toán / chủ sửa: chỉ dòng thay đổi; không đổi gì thì tóm tắt đơn', () => {
    expect(describeAudit({ action: 'order_create', entity: 'order', reason: null, before: null, after: order() })).toEqual(['2× Xôi gà (Trứng) · 62.000']);
    expect(describeAudit({ action: 'order_serve', entity: 'order', reason: null, before: order({ status: 'open' }), after: order() })).toEqual([
      'Trạng thái: chờ ra món → đã ra món',
    ]);
    expect(describeAudit({ action: 'order_pay', entity: 'order', reason: null, before: order(), after: order({ status: 'paid', payment_method: 'cash' }) })).toEqual([
      'Trạng thái: đã ra món → đã thanh toán',
      'Hình thức: — → tiền mặt',
    ]);
    expect(
      describeAudit({
        action: 'owner_edit_order', entity: 'order', reason: null,
        before: order({ status: 'paid', payment_method: 'cash' }), after: order({ status: 'paid', payment_method: 'transfer' }),
      }),
    ).toEqual(['Hình thức: tiền mặt → chuyển khoản']);
    expect(
      describeAudit(
        { action: 'debt_transfer', entity: 'order', reason: null, before: order({ customer_id: 'c1' }), after: order({ customer_id: 'c2' }) },
        { customer: (id) => (id === 'c1' ? 'Dũng (phường B)' : 'Dũng (giáo viên)') },
      ),
    ).toEqual(['Khách nợ: Dũng (phường B) → Dũng (giáo viên)']);
    expect(
      describeAudit({ action: 'order_update', entity: 'order', reason: null, before: order(), after: order({ dine_type: 'dinein', label: 'Bàn 2' }) }),
    ).toEqual(['Mang về → Tại chỗ', 'Nhãn: — → Bàn 2']);
    expect(describeAudit({ action: 'order_update', entity: 'order', reason: null, before: order(), after: order() })).toEqual(['2× Xôi gà (Trứng) · 62.000']);
  });

  it('ca, nợ, cảnh báo, cài đặt', () => {
    const d = (action: string, after: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      describeAudit({ action, entity: 'x', reason: null, before: null, after, ...extra });
    expect(d('shift_open', { open_boxes: 200, open_plates: 60, open_float: 500_000 })).toEqual(['Đầu ca: hộp 200 · dĩa 60 · tiền lẻ 500.000']);
    expect(d('shift_close', { close_boxes_left: 190, close_plates_left: 59, close_cash_counted: 539_000 })).toEqual([
      'Đếm: hộp 190 · dĩa 59 · tiền 539.000',
    ]);
    expect(d('shift_adjust', { kind: 'boxes', qty: 50, note: 'mang thêm' })).toEqual(['+50 hộp · mang thêm']);
    expect(d('shift_adjust', { kind: 'cash', qty: 200_000 })).toEqual(['+200.000 tiền lẻ']);
    expect(d('shift_adjust', { kind: 'plates', qty: 5 })).toEqual(['+5 dĩa']);
    expect(d('debt_payment', { amount: 50_000, method: 'cash' })).toEqual(['50.000 · tiền mặt']);
    expect(d('debt_payment', { amount: 1, method: 'transfer' })).toEqual(['1 · chuyển khoản']);
    expect(d('customer_create', { name: 'Tú', description: 'bán vé số', phone: null })).toEqual(['Tú · bán vé số']);
    expect(d('seq_gap', { missing: [3, 4], received: 5 })).toEqual(['Thiếu số 3, 4 (nhận được số 5)']);
    expect(describeAudit({ action: 'sync_rejected', entity: 'create_order', reason: 'price_mismatch', before: null, after: {} })).toEqual([
      'create_order: price_mismatch',
    ]);
    expect(
      describeAudit({ action: 'settings_update', entity: 'products', reason: null, before: { name: 'Xôi gà', price: 25_000 }, after: { name: 'Xôi gà', price: 28_000 } }),
    ).toEqual(['products "Xôi gà": price 25000 → 28000']);
    expect(describeAudit({ action: 'settings_create', entity: 'staff', reason: null, before: null, after: { name: 'Hà' } })).toEqual(['staff "Hà"']);
    expect(d('tablet_login', {})).toEqual([]);
    expect(describeAudit({ action: 'owner_mode', entity: 'tablet_profile', reason: null, before: null, after: null })).toEqual([]);
  });

  it('bản ghi thiếu trường (nhật ký cũ, dữ liệu lạ) không làm vỡ mô tả', () => {
    const empty = { action: 'order_update', entity: 'order', reason: null };
    expect(describeAudit({ ...empty, before: {}, after: {} })).toEqual([' · 0']);
    expect(describeAudit({ ...empty, before: null, after: null })).toEqual([]);
    expect(describeAudit({ ...empty, action: 'order_create', before: null, after: {} })).toEqual([' · 0']);
    expect(describeAudit({ ...empty, action: 'order_delete', reason: null, before: null, after: null })).toEqual(['Lý do: — · lúc xóa chưa ra món']);
    expect(describeAudit({ ...empty, action: 'order_delete', reason: 'la', before: {}, after: {} })[0]).toBe('Lý do: la · lúc xóa chưa ra món');
    expect(describeAudit({ ...empty, before: { status: 'weird' }, after: { status: 'open', payment_method: 'cash', total: 1 } })).toEqual([
      'Tổng: 0 → 1',
      'Trạng thái: weird → chờ ra món',
      'Hình thức: — → tiền mặt',
    ]);
    expect(describeAudit({ ...empty, action: 'debt_transfer', before: { customer_id: 'a' }, after: { customer_id: 'b' } })).toEqual([
      'Khách nợ: a → b',
    ]);
    expect(describeAudit({ ...empty, action: 'debt_transfer', before: {}, after: { customer_id: 'b' } })).toEqual(['Khách nợ: — → b']);
    expect(describeAudit({ ...empty, before: { label: 'A' }, after: {} })).toEqual(['Nhãn: A → —']);
    const d = (action: string, after: Record<string, unknown> | null) => describeAudit({ action, entity: 'x', reason: null, before: null, after });
    expect(d('shift_close', null)).toEqual(['Đếm: hộp undefined · dĩa undefined · tiền 0']);
    expect(d('shift_open', {})).toEqual(['Đầu ca: hộp undefined · dĩa undefined · tiền lẻ 0']);
    expect(d('debt_payment', {})).toEqual(['0 · chuyển khoản']);
    expect(d('seq_gap', {})).toEqual(['Thiếu số undefined (nhận được số undefined)']);
    expect(describeAudit({ action: 'settings_update', entity: 'settings', reason: null, before: null, after: { wait_red_min: 12, updated_at: 'x' } })).toEqual([
      'settings: wait_red_min undefined → 12',
    ]);
  });
});

describe('sổ lương', () => {
  it('mô tả dòng ghi / hủy sổ lương', () => {
    const after = { kind: 'days', amount: 1, month: '2026-11-01', note: 'Phụ dọn', staff_name: 'Lan' };
    expect(describeAudit({ action: 'payroll_add', entity: 'payroll_entries', reason: null, before: null, after })).toEqual([
      'Lan · Tháng 11/2026: Cộng / trừ ngày công +1 ngày (Phụ dọn)',
    ]);
    expect(actionsForFilter('owner')).toContain('payroll_void');
    expect(actionLabel('payroll_void')).toBe('Hủy dòng sổ lương');
  });
});

describe('đánh dấu ngày', () => {
  it('mô tả đánh / sửa / bỏ ngày nghỉ', () => {
    const after = { day: '2026-11-20', reason: 'Về quê', staff_name: 'Lan' };
    expect(describeAudit({ action: 'day_off_add', entity: 'staff_days_off', reason: null, before: null, after })).toEqual(['Lan · 20/11/2026 (Về quê)']);
    expect(
      describeAudit({ action: 'day_off_update', entity: 'staff_days_off', reason: null, before: { ...after, reason: null }, after }),
    ).toEqual(['Lan · 20/11/2026 (— → Về quê)']);
    expect(describeAudit({ action: 'day_off_remove', entity: 'staff_days_off', reason: null, before: after, after: { ...after, reason: null } })).toEqual([
      'Lan · 20/11/2026',
    ]);
    expect(actionsForFilter('owner')).toContain('day_off_remove');
    expect(actionLabel('day_off_add')).toBe('Đánh ngày nghỉ');
  });

  it('mô tả đổi nghỉ ↔ có làm', () => {
    const before = { day: '2026-11-20', kind: 'off', reason: null, staff_name: 'Lan' };
    const after = { ...before, kind: 'work', reason: 'Phụ dọn kho' };
    expect(describeAudit({ action: 'day_work_update', entity: 'staff_day_marks', reason: null, before, after })).toEqual([
      'Lan · 20/11/2026 (Nghỉ → Có làm, — → Phụ dọn kho)',
    ]);
    expect(actionsForFilter('owner')).toContain('day_work_add');
    expect(actionLabel('day_work_add')).toBe('Đánh ngày có làm');
  });
});
