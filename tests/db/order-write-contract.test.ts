// Hợp đồng ghi đơn chạy trên Supabase thật (sync_push). Cùng danh sách ca với src/pos/orderWrite.contract.test.ts (FakeServer).
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, it } from 'vitest';
import { ORDER_WRITE_CASES, type OrderWriteWorld } from '@/pos/orderWrite.contract';
import { createSupabaseBackend } from '@/pos';
import { resetDb, sql, tabletClient } from '../support/db';
import { SEED } from '../support/seed-ids';

const TABLES = { product: 'products', topping: 'toppings', point: 'points' } as const;
let client: SupabaseClient | null = null;

async function world(): Promise<OrderWriteWorld> {
  await resetDb();
  client = await tabletClient(SEED.tablets.A);
  const backend = createSupabaseBackend(client);
  const shift_id = crypto.randomUUID();
  await backend.push({ op_id: crypto.randomUUID(), kind: 'open_shift', entity_id: shift_id, payload: { shift_id, staff_id: SEED.staff.Lan } });
  const { shift } = await backend.loadOpenState(SEED.tablets.A);
  return {
    backend,
    profileId: SEED.tablets.A,
    shift: shift!,
    points: { main: SEED.points.xoiA, otherMenu: SEED.points.com, forbidden: SEED.points.xoiB },
    product: { id: SEED.products.xoiGa, price: SEED.prices.xoiGa },
    topping: { id: SEED.toppings.trung, price: SEED.prices.trung },
    otherMenuProduct: { id: SEED.products.comGa, price: SEED.prices.comGa },
    otherMenuTopping: { id: SEED.toppings.canh, price: SEED.prices.canh },
    customer: SEED.customers.dungGv,
    deactivate: async (kind, id) => {
      await sql(`update public.${TABLES[kind]} set active = false where id = $1`, [id]);
    },
  };
}

afterEach(async () => {
  await client?.removeAllChannels();
  client = null;
});

describe('hợp đồng ghi đơn (Supabase)', () => {
  for (const c of ORDER_WRITE_CASES) it(c.name, async () => c.run(await world()));
});
