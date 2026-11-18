import { defineConfig } from 'cypress';
import { resetDb, sql, tabletClient, withPg } from './tests/support/db';
import { ENV } from './tests/support/env';
import { TabletSim, item, push, type TestItem } from './tests/support/ops';
import { SEED } from './tests/support/seed-ids';
import { telegramClear, telegramMessages, waitForMessage } from './tests/support/telegram';

// Trạng thái kịch bản G32 giữa các task (tablet giả lập phía server).
let g32: { sim: TabletSim; orderId: string; line: TestItem } | null = null;

type TabletKey = keyof typeof SEED.tablets;
type ProductKey = keyof typeof SEED.products;
type ToppingKey = keyof typeof SEED.toppings;

// Tablet giả lập phía server, giữ qua các task trong một kịch bản (device_seq liên tục). Xóa khi db:reset.
const sims = new Map<TabletKey, TabletSim>();
async function simFor(tablet: TabletKey): Promise<TabletSim> {
  let sim = sims.get(tablet);
  if (!sim) {
    sim = new TabletSim(await tabletClient(SEED.tablets[tablet]), SEED.tablets[tablet]);
    sims.set(tablet, sim);
  }
  return sim;
}

function ok(what: string, r: { status: string }) {
  if (r.status !== 'ok') throw new Error(`${what}: ${JSON.stringify(r)}`);
}

interface SellArgs {
  tablet: TabletKey;
  product: ProductKey;
  toppings?: ToppingKey[];
  qty?: number;
  point?: keyof typeof SEED.points;
  /** Không có ⇒ đơn để mở. */
  method?: 'cash' | 'transfer' | 'debt';
  customer?: keyof typeof SEED.customers;
}

/** Tạo (và thu tiền) một đơn trên tablet giả lập. Trả id, mã, tổng. */
async function simSell(a: SellArgs) {
  const sim = await simFor(a.tablet);
  const extra = a.point ? { point_id: SEED.points[a.point], dine_type: a.point === 'com' ? 'dinein' : 'takeaway' } : {};
  const o = await sim.createOrder([item(a.product, a.toppings ?? [], a.qty ?? 1)], extra);
  ok('tạo đơn', o.result);
  if (a.method) {
    const customer = a.customer ? { customer: { id: SEED.customers[a.customer], name: 'Dũng' } } : {};
    ok('thanh toán', await sim.pay(o.id, o.total, a.method, customer));
  }
  // Mã đơn do server cấp (mã máy gửi lên bị bỏ qua).
  return { id: o.id, total: o.total, code: (o.result as { order?: { code: string } }).order!.code };
}

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4173',
    viewportWidth: 1280,
    viewportHeight: 800,
    video: true,
    screenshotOnRunFailure: true,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    setupNodeEvents(on, config) {
      // Chỉ URL + anon key (công khai, đã có trong bundle) cho cy.request; service key không ra khỏi Node.
      config.env.SUPABASE_URL = ENV.url;
      config.env.SUPABASE_ANON_KEY = ENV.anonKey;

      on('task', {
        'db:reset': async () => {
          await resetDb();
          sims.clear();
          return null;
        },
        /** Tablet giả lập mở ca. Trả id ca. */
        'sim:openShift': async ({ tablet, staff }: { tablet: TabletKey; staff: keyof typeof SEED.staff }) => {
          const sim = await simFor(tablet);
          ok('mở ca', await sim.openShift(staff));
          return sim.shiftId;
        },
        'sim:sell': (a: SellArgs) => simSell(a),
        /** Đóng ca hiện tại của tablet giả lập. Trả id ca. */
        'sim:close': async ({ tablet, boxes, plates, cash }: { tablet: TabletKey; boxes: number; plates: number; cash: number }) => {
          const sim = await simFor(tablet);
          ok('đóng ca', await sim.closeShift(boxes, plates, cash));
          return sim.shiftId;
        },
        /**
         * G35 / G36: hôm nay
         * - Lan (Tablet A): TM 25.000, CK 15.000 (sửa 2 → 1 phần trước khi thu), Nợ 20.000; 1 đơn xóa sau khi ra món
         * - Mai (Tablet B): CK 30.000; 1 đơn sửa 2 lần rồi xóa (bấm nhầm)
         * - Hùng: không bán
         */
        'scenario:staffReport': async () => {
          const a = await simFor('A');
          const b = await simFor('B');
          ok('mở ca A', await a.openShift('Lan'));
          ok('mở ca B', await b.openShift('Mai'));
          const cash = await simSell({ tablet: 'A', product: 'xoiGa', method: 'cash' });
          const tr = await simSell({ tablet: 'A', product: 'xoiXeo', qty: 2 });
          ok('sửa', await a.update(tr.id, [item('xoiXeo')]));
          ok('thu CK', await a.pay(tr.id, 15_000, 'transfer'));
          const debt = await simSell({ tablet: 'A', product: 'xoiPate', method: 'debt', customer: 'dungGv' });
          const del = await simSell({ tablet: 'A', product: 'xoiGa' });
          ok('ra món', await a.serve(del.id));
          ok('xóa', await a.del(del.id, 'customer_left'));

          const bTr = await simSell({ tablet: 'B', product: 'xoiTc', method: 'transfer' });
          const bDel = await simSell({ tablet: 'B', product: 'xoiXeo', qty: 3 });
          ok('sửa 1', await b.update(bDel.id, [item('xoiXeo', [], 2)]));
          ok('sửa 2', await b.update(bDel.id, [item('xoiXeo', [], 1)]));
          ok('xóa B', await b.del(bDel.id, 'mistake'));
          return { cash: cash.id, tr: tr.id, debt: debt.id, del: del.id, bTr: bTr.id, bDel: bDel.id };
        },
        'telegram:clear': async () => {
          await telegramClear();
          return null;
        },
        'telegram:messages': () => telegramMessages(),
        /** Chờ tới khi có tin chứa đoạn chữ (pg_net + Edge Function chạy bất đồng bộ). */
        'telegram:waitFor': (text: string) => waitForMessage((m) => m.text.includes(text)),
        /** Dữ liệu phía server cho kịch bản gọi API trực tiếp: 1 đơn mở, 1 đơn đã thanh toán, 1 đơn đã xóa. */
        'scenario:tabletOrders': async (tablet: keyof typeof SEED.tablets) => {
          const sim = new TabletSim(await tabletClient(SEED.tablets[tablet]), SEED.tablets[tablet]);
          await sim.openShift('Lan');
          const open = await sim.createOrder([item('xoiGa')]);
          const paid = await sim.createOrder([item('xoiXeo')]);
          const deleted = await sim.createOrder([item('xoiPate')]);
          await sim.pay(paid.id, paid.total);
          await sim.del(deleted.id);
          return { open: open.id, paid: paid.id, deleted: deleted.id };
        },
        /** G32: tablet A có một đơn đang mở (1 Xôi gà, giá lúc tạo 25.000). */
        'g32:openOrder': async () => {
          const sim = new TabletSim(await tabletClient(SEED.tablets.A), SEED.tablets.A);
          await sim.openShift('Lan');
          const line = item('xoiGa');
          const o = await sim.createOrder([line]);
          if (o.result.status !== 'ok') throw new Error(`tạo đơn: ${JSON.stringify(o.result)}`);
          g32 = { sim, orderId: o.id, line };
          return o.id;
        },
        /** G32 sau khi chủ đổi giá: đơn đang mở giữ giá cũ, đơn mới phải dùng giá mới. */
        'g32:afterPriceChange': async (newPrice: number) => {
          if (!g32) throw new Error('chưa chạy g32:openOrder');
          const { sim, orderId, line } = g32;
          const [snap] = await sql<{ unit_price_snap: number }>(
            'select unit_price_snap from order_items where order_id = $1 and removed_at is null',
            [orderId],
          );
          const editOld = await sim.update(orderId, [{ ...line, qty: 2 }]);
          const [edited] = await sql<{ total: number }>('select total from orders where id = $1', [orderId]);
          const late = sim.createOrderOp([item('xoiGa')]);
          late.op.performed_at = new Date().toISOString();
          const newWithOldPrice = await push(sim.c, late.op);
          const newWithNewPrice = await sim.createOrder([{ ...item('xoiGa'), unit_price_snap: newPrice }]);
          return {
            openSnap: snap.unit_price_snap,
            editOld: editOld.status,
            editedTotal: edited.total,
            newWithOldPrice: newWithOldPrice.status,
            newWithNewPrice: newWithNewPrice.result.status,
          };
        },
        /** Các ca của tablet trên server (cũ trước), kèm tên nhân viên. */
        /** Lùi giờ tạo đơn trên server (theo nhãn đơn, số phút trước bây giờ): giờ tạo đơn là giờ server. */
        'db:ageOrders': async (ages: Record<string, number>) => {
          for (const [label, mins] of Object.entries(ages)) {
            await sql('update orders set created_at = now() - make_interval(mins => $2) where label = $1', [label, mins]);
          }
          return null;
        },
        'db:shifts': (tablet: keyof typeof SEED.tablets) =>
          sql(
            `select s.id, st.name as staff_name, s.status, s.open_boxes, s.open_plates, s.open_float,
                    s.close_boxes_left, s.close_plates_left, s.close_cash_counted
               from shifts s join staff st on st.id = s.staff_id
              where s.tablet_profile_id = $1 order by s.opened_at`,
            [SEED.tablets[tablet]],
          ),
        /** Số mặc định đầu ca của hồ sơ tablet. */
        'db:profileDefaults': async (tablet: keyof typeof SEED.tablets) => {
          const [r] = await sql('select default_boxes, default_plates, default_float from tablet_profiles where id = $1', [SEED.tablets[tablet]]);
          return r;
        },
        /** Đơn của tablet trên server (theo device_seq), kèm dòng đơn còn hiệu lực. */
        'db:orders': (tablet: keyof typeof SEED.tablets) =>
          sql(
            `select o.id, o.device_seq, o.code, o.point_id, o.dine_type, o.status, o.total, o.label,
                    o.payment_method, o.cash_given, o.opened_shift_id, o.paid_shift_id,
                    o.served_at is not null as served, o.delete_reason,
                    coalesce((select json_agg(json_build_object('product_id', i.product_id, 'qty', i.qty,
                                'unit_price_snap', i.unit_price_snap, 'toppings', i.toppings_snap) order by i.sort)
                                from order_items i where i.order_id = o.id and i.removed_at is null), '[]') as items
               from orders o where o.tablet_profile_id = $1 order by o.device_seq`,
            [SEED.tablets[tablet]],
          ),
        /** Đóng ca đang mở của tablet bằng tablet giả lập phía server (khi máy thật đã bị xóa để giả lập điện thoại chủ). */
        'sim:closeShift': async ({ tablet, boxes, plates, cash }: { tablet: keyof typeof SEED.tablets; boxes: number; plates: number; cash: number }) => {
          const [s] = await sql<{ id: string }>("select id from shifts where tablet_profile_id = $1 and status = 'open'", [SEED.tablets[tablet]]);
          if (!s) throw new Error('không có ca đang mở');
          const sim = new TabletSim(await tabletClient(SEED.tablets[tablet]), SEED.tablets[tablet]);
          sim.shiftId = s.id;
          const r = await sim.closeShift(boxes, plates, cash);
          if (r.status !== 'ok') throw new Error(`đóng ca: ${JSON.stringify(r)}`);
          return s.id;
        },
        /** Khách nợ trên server. */
        'db:customers': () => sql('select id, name, description, phone, created_by_shift_id from customers order by name, description'),
        /** Dư nợ theo khách gốc (cùng hàm server dùng cho Telegram / tablet). */
        'db:balance': async (customerId: string) => {
          const [r] = await sql<{ b: number }>('select private.customer_balance($1) as b', [customerId]);
          return r.b;
        },
        /** Đối soát ca (hàm SQL). */
        'db:reconcile': async (shiftId: string) => {
          const [r] = await sql<{ r: unknown }>('select private.reconcile_shift($1) as r', [shiftId]);
          return r.r;
        },
        /**
         * Nợ có sẵn: tablet B (giả lập phía server) mở ca, bán các đơn ghi nợ cho khách đã chỉ định rồi đóng ca.
         * Trả về id các đơn theo thứ tự.
         */
        'scenario:debts': async (sales: Array<{ customer: keyof typeof SEED.customers; product: keyof typeof SEED.products }>) => {
          const sim = new TabletSim(await tabletClient(SEED.tablets.B), SEED.tablets.B);
          if ((await sim.openShift('Mai')).status !== 'ok') throw new Error('mở ca B');
          const ids: string[] = [];
          for (const s of sales) {
            const o = await sim.createOrder([item(s.product)]);
            const r = await sim.pay(o.id, o.total, 'debt', { customer: { id: SEED.customers[s.customer], name: 'Dũng' } });
            if (o.result.status !== 'ok' || r.status !== 'ok') throw new Error(`ghi nợ: ${JSON.stringify([o.result, r])}`);
            ids.push(o.id);
          }
          await sim.closeShift(150, 0, 300_000);
          return ids;
        },
        /**
         * H38: cron thật của Supabase local chạy mỗi phút ⇒ dời giờ tổng kết sang 23:59 để nó không tự gửi giữa test,
         * và bỏ tin tổng kết nó có thể đã gửi ngay sau khi reset.
         */
        'summary:prepare': async () => {
          await withPg(async (c) => {
            await c.query(`update settings set daily_summary_time = '23:59'`);
            await c.query('alter table notifications disable trigger forbid_delete');
            await c.query(`delete from notifications where kind = 'daily_summary'`);
            await c.query('alter table notifications enable trigger forbid_delete');
          });
          return null;
        },
        /** "Tua đồng hồ": gọi thẳng hàm cron với thời điểm hôm nay (giờ VN) lúc `hhmm`. Trả id thông báo hoặc null. */
        'cron:tick': async (hhmm: string) => {
          const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
          const [r] = await sql<{ id: string | null }>('select private.daily_summary_tick($1::timestamptz) as id', [`${today}T${hhmm}:00+07:00`]);
          return r.id;
        },
        /** Hồ sơ tablet đang lưu trên server. */
        'db:profilePoints': async (tablet: keyof typeof SEED.tablets) => {
          const [r] = await sql<{ point_ids: string[] }>('select point_ids from tablet_profiles where id = $1', [SEED.tablets[tablet]]);
          return r.point_ids;
        },
      });
      return config;
    },
  },
});
