import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildItem } from '@/domain/pricing';
import { XOI_GA } from '@/domain/fixtures';
import type { Customer, TabletProfile } from '@/domain/types';
import { LaodaiDB, META, setMeta, type OutboxEntry } from './db';
import { debtBook, hasSettledDebt, loadDebtJournal, pruneDebtJournal, type DebtJournalEntry } from './debtLocal';
import { flushOutbox, type PushResult, type SyncTransport } from './engine';
import { createOrder, openShift, payOrder, recordDebtPayment } from './localOps';
import { refreshCatalog, type CatalogData } from './catalog';

const PROFILE: TabletProfile = { id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a'], default_boxes: 0, default_plates: 0, default_float: 0 };
const C = (id: string, name: string, description: string | null = null, merged_into_id: string | null = null): Customer => ({
  id, name, description, phone: null, merged_into_id,
});
const GV = C('c-gv', 'Dũng', 'giáo viên');
const PB = C('c-pb', 'Dũng', 'phường B');

let db: LaodaiDB;
let n = 0;
let t = Date.parse('2026-11-17T23:00:00Z');
const clock = () => new Date((t += 1000));

const catalogData = (balances: Record<string, number>, customers = [GV, PB]): CatalogData => ({
  profile: PROFILE, menus: [], points: [], products: [], toppings: [], combos: [], staff: [],
  config: { wait_yellow_min: 5, wait_red_min: 10, timezone: 'Asia/Ho_Chi_Minh' },
  customers, balances,
});

class Server implements SyncTransport {
  reject = new Set<string>();
  async push(op: OutboxEntry): Promise<PushResult> {
    return this.reject.has(op.kind) ? { status: 'rejected', reason: 'bad_customer' } : { status: 'ok' };
  }
}

async function sale(total = 25_000) {
  return createOrder(db, { point_id: 'xoi-a', dine_type: 'takeaway', items: [buildItem(`i${++n}`, { ...XOI_GA, price: total }, [], 1)] }, clock);
}

beforeEach(async () => {
  db = new LaodaiDB(`debt-${++n}`);
  await setMeta(db, META.activation, { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: '', owner_email: '' });
  await openShift(db, { staff_id: 's', staff_name: 'Lan', profile: PROFILE }, clock);
});

afterEach(async () => {
  await db.delete();
});

describe('sổ nợ trên tablet', () => {
  it('ghi nợ / thu nợ trên máy cộng ngay vào dư nợ tải về, kể cả khi chưa đồng bộ', async () => {
    const cat = await refreshCatalog(db, async () => catalogData({ 'c-gv': 40_000, 'c-pb': 0 }), clock);
    const o = await sale(25_000);
    await payOrder(db, o.id, { method: 'debt', customer: { id: 'c-gv', name: 'Dũng' } }, clock);
    await recordDebtPayment(db, { customer_id: 'c-gv', amount: 50_000, method: 'cash' }, clock);
    const book = debtBook(cat, await loadDebtJournal(db));
    expect(book.balance('c-gv')).toBe(40_000 + 25_000 - 50_000);
    expect(book.balance('c-pb')).toBe(0);
    expect(book.balance('khong-co')).toBe(0);
  });

  it('khách mới tạo khi ghi nợ: có ngay trong danh sách gợi ý, dư nợ = đơn vừa ghi', async () => {
    const cat = await refreshCatalog(db, async () => catalogData({}), clock);
    const o = await sale(31_000);
    await payOrder(db, o.id, { method: 'debt', customer: { name: 'Hùng', description: 'xe ôm' } }, clock);
    const book = debtBook(cat, await loadDebtJournal(db));
    const hung = book.customers.find((c) => c.name === 'Hùng')!;
    expect(hung).toMatchObject({ description: 'xe ôm', phone: null, merged_into_id: null });
    expect(book.balance(hung.id)).toBe(31_000);
    expect(book.customers).toHaveLength(3);
  });

  it('đồng bộ xong vẫn giữ khoản đó tới khi danh mục tải lại; tải lại (bắt đầu sau lúc đồng bộ) thì bỏ, không cộng hai lần', async () => {
    await refreshCatalog(db, async () => catalogData({ 'c-gv': 0 }), clock);
    const o = await sale(25_000);
    await payOrder(db, o.id, { method: 'debt', customer: { id: 'c-gv', name: 'Dũng' } }, clock);
    await flushOutbox(db, new Server(), clock);
    const journal = await loadDebtJournal(db);
    expect(journal).toHaveLength(1);
    expect(journal[0].synced_at).not.toBeNull();
    expect(hasSettledDebt(journal)).toBe(true);
    // Danh mục cũ (tải trước khi đồng bộ) chưa có khoản này ⇒ vẫn cộng
    expect(debtBook((await db.meta.get(META.catalog))!.value as never, journal).balance('c-gv')).toBe(25_000);
    // Tải lại: server đã có khoản này ⇒ nhật ký bỏ khoản đó
    const fresh = await refreshCatalog(db, async () => catalogData({ 'c-gv': 25_000 }), clock);
    expect(await loadDebtJournal(db)).toEqual([]);
    expect(debtBook(fresh, []).balance('c-gv')).toBe(25_000);
  });

  it('server từ chối khoản thu nợ ⇒ bỏ khỏi nhật ký (dư nợ trở lại như cũ)', async () => {
    const cat = await refreshCatalog(db, async () => catalogData({ 'c-pb': 100_000 }), clock);
    await recordDebtPayment(db, { customer_id: 'c-pb', amount: 30_000, method: 'transfer' }, clock);
    expect(debtBook(cat, await loadDebtJournal(db)).balance('c-pb')).toBe(70_000);
    const server = new Server();
    server.reject.add('debt_payment');
    await flushOutbox(db, server, clock);
    expect(await loadDebtJournal(db)).toEqual([]);
    expect(debtBook(cat, []).balance('c-pb')).toBe(100_000);
  });

  it('thanh toán tiền mặt / chuyển khoản không đụng sổ nợ', async () => {
    const o = await sale();
    await payOrder(db, o.id, { method: 'cash', cash_given: 25_000 }, clock);
    await flushOutbox(db, new Server(), clock);
    expect(await loadDebtJournal(db)).toEqual([]);
  });

  it('khách đã gộp không hiện; nợ ghi cho khách đã gộp tính vào khách gốc; chưa có danh mục vẫn dùng được', () => {
    const old = C('c-old', 'Dung cũ', null, 'c-gv');
    const entry = (customer_id: string, delta: number, synced_at: string | null = null): DebtJournalEntry => ({
      op_id: `${customer_id}${delta}`, customer_id, delta, new_customer: null, at: '', synced_at,
    });
    const book = debtBook({ customers: [GV, old], balances: { 'c-gv': 10_000 }, fetched_at: '2026-11-17T10:00:00.000Z' }, [entry('c-old', 5_000)]);
    expect(book.customers.map((c) => c.id)).toEqual(['c-gv']);
    expect(book.balance('c-gv')).toBe(15_000);
    expect(book.balance('c-old')).toBe(15_000);
    expect(debtBook(undefined, [entry('x', 7_000)]).balance('x')).toBe(7_000);
    // Lọc theo thời điểm tải danh mục
    const es = [entry('a', 1, null), entry('b', 2, '2026-11-17T09:00:00.000Z'), entry('c', 3, '2026-11-17T11:00:00.000Z')];
    expect(pruneDebtJournal(es, '2026-11-17T10:00:00.000Z').map((e) => e.customer_id)).toEqual(['a', 'c']);
    expect(hasSettledDebt([entry('a', 1)])).toBe(false);
  });
});
