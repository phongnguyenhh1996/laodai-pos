// Hợp đồng ghi đơn chạy trên FakeServer. Bản chạy trên Supabase thật: tests/db/order-write-contract.test.ts.
import { describe, it } from 'vitest';
import { CANH, COM_GA, TRUNG, XOI_GA } from '@/domain/fixtures';
import { FakeServer } from '@/test-utils/fakeServer';
import { CATALOG } from '@/test-utils/tablet';
import { ORDER_WRITE_CASES, type OrderWriteWorld } from './orderWrite.contract';

async function world(): Promise<OrderWriteWorld> {
  const server = new FakeServer(CATALOG);
  const backend = server.device();
  const shift_id = crypto.randomUUID();
  await backend.push({ op_id: crypto.randomUUID(), kind: 'open_shift', entity_id: shift_id, payload: { shift_id, staff_id: 's1' } });
  const tables = { product: server.catalog.products, topping: server.catalog.toppings, point: server.catalog.points };
  return {
    backend,
    profileId: CATALOG.profile.id,
    shift: server.openState().shift!,
    points: { main: 'xoi-a', otherMenu: 'com', forbidden: 'xoi-b' },
    product: XOI_GA,
    topping: TRUNG,
    otherMenuProduct: COM_GA,
    otherMenuTopping: CANH,
    customer: 'c-gv',
    deactivate: async (kind, id) => {
      for (const x of tables[kind]) if (x.id === id) x.active = false;
    },
  };
}

describe('hợp đồng ghi đơn (FakeServer)', () => {
  for (const c of ORDER_WRITE_CASES) it(c.name, async () => c.run(await world()));
});
