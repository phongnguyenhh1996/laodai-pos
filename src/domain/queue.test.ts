import { describe, expect, it } from 'vitest';
import { buildQueue, queueCounts, queueStrip, waitColor } from './queue';
import { order } from './fixtures';

const S = { wait_yellow_min: 5, wait_red_min: 10 };
const T0 = Date.parse('2026-11-17T23:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

describe('queue', () => {
  it('xếp theo created_at tăng dần, "Chờ ra món" trước "Chờ thanh toán"', () => {
    const o1 = order({ created_at: at(2), status: 'served' });
    const o2 = order({ created_at: at(1) });
    const o3 = order({ created_at: at(0), status: 'served' });
    const o4 = order({ created_at: at(3) });
    const q = buildQueue([o1, o2, o3, o4], at(4), S);
    expect(q.serve.map((c) => c.order.id)).toEqual([o2.id, o4.id]);
    expect(q.pay.map((c) => c.order.id)).toEqual([o3.id, o1.id]);
    expect([...q.serve, ...q.pay].map((c) => c.position)).toEqual([1, 2, 3, 4]);
  });

  it('cùng giờ tạo thì theo device_seq', () => {
    const a = order({ created_at: at(0), device_seq: 9 });
    const b = order({ created_at: at(0), device_seq: 3 });
    expect(buildQueue([a, b], at(1), S).serve.map((c) => c.order.id)).toEqual([b.id, a.id]);
  });

  it('số thứ tự đánh lại liên tục khi có đơn rời hàng; đơn paid/deleted không hiện', () => {
    const os = [0, 1, 2, 3].map((m) => order({ created_at: at(m) }));
    const after = os.map((o, i) => (i === 1 ? { ...o, status: 'paid' as const } : i === 2 ? { ...o, status: 'deleted' as const } : o));
    const q = buildQueue(after, at(5), S);
    expect(q.serve.map((c) => [c.order.id, c.position])).toEqual([[os[0].id, 1], [os[3].id, 2]]);
  });

  it('màu theo thời gian chờ, ngưỡng lấy từ cài đặt', () => {
    const o = order({ created_at: at(0) });
    expect(waitColor(o, at(4.99), S)).toBe('normal');
    expect(waitColor(o, at(5), S)).toBe('yellow');
    expect(waitColor(o, at(9.99), S)).toBe('yellow');
    expect(waitColor(o, at(10), S)).toBe('red');
    const custom = { wait_yellow_min: 2, wait_red_min: 3 };
    expect(waitColor(o, at(2), custom)).toBe('yellow');
    expect(waitColor(o, at(3), custom)).toBe('red');
  });

  it('đơn đã ra món không đổi màu', () => {
    const o = order({ created_at: at(0), status: 'served' });
    expect(waitColor(o, at(60), S)).toBe('none');
    const q = buildQueue([o], at(60), S);
    expect(q.pay[0].color).toBe('none');
    expect(q.pay[0].waitMinutes).toBe(60);
  });

  it('dải đơn: Tất cả = chờ ra món trước, chờ thanh toán sau; chip nhóm chỉ hiện nhóm đó; số đếm từng chip', () => {
    const p1 = order({ created_at: at(0), status: 'served' });
    const s1 = order({ created_at: at(1) });
    const s2 = order({ created_at: at(2) });
    const q = buildQueue([s2, p1, s1], at(3), S);
    const ids = (f: 'all' | 'serve' | 'pay') => queueStrip(q.serve, q.pay, f).map((c) => c.order.id);
    expect(ids('all')).toEqual([s1.id, s2.id, p1.id]);
    expect(ids('serve')).toEqual([s1.id, s2.id]);
    expect(ids('pay')).toEqual([p1.id]);
    expect(queueCounts(q)).toEqual({ all: 3, serve: 2, pay: 1 });
    expect(queueCounts(buildQueue([], at(0), S))).toEqual({ all: 0, serve: 0, pay: 0 });
  });
});
