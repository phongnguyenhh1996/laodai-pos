// @vitest-environment jsdom
// In phiếu bếp & bill trên tablet (SPEC mục 12) với máy in giả: tự in theo công tắc, in lại phiếu bếp,
// lỗi in không chặn bán hàng, PWA không in.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { App } from '@/app/App';
import { XOI_GA, XOI_XEO } from '@/domain/fixtures';
import { setEditDelay, setPrintService } from '@/lib/print';
import { FakeTransport, PRINTER_KEY, Printer } from '@/print/printer';
import { PrintService, type CreateArgs, type CreateResult, type PrintApi } from '@/print/service';
import { DEFAULT_TEMPLATE, type PrintDoc } from '@/print/types';
import { ACT, CATALOG, activateDevice, resetTablet, server, useFakeServer } from '@/test-utils/tablet';

const tid = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(tid(id));

let created: CreateArgs[];
let finished: Array<{ ok: boolean; error?: string | null }>;
let transport: FakeTransport;

function docOf(orderId: string): PrintDoc {
  const o = server.order(orderId)!;
  return {
    order_id: o.id,
    code: o.code,
    status: o.status,
    dine_type: o.dine_type,
    label: o.label,
    table_no: o.table_no,
    point_name: 'Xôi A',
    created_at: o.created_at,
    paid_at: o.paid_at,
    edited_at: null,
    total: o.total,
    items: o.items.map((i) => ({ name: i.name_snap, qty: i.qty, unit_price: i.unit_price_snap, toppings: [] })),
  };
}

function usePrinter({ supported = true } = {}) {
  created = [];
  finished = [];
  transport = new FakeTransport();
  localStorage.setItem(PRINTER_KEY, JSON.stringify(transport.devices[0]));
  const api: PrintApi = {
    async create(a): Promise<CreateResult> {
      created.push(a);
      return {
        status: 'claimed',
        job: {
          id: `j${created.length}`,
          kind: a.kind,
          order_id: a.orderId ?? null,
          tablet_profile_id: ACT.tablet_profile_id,
          source: a.source ?? 'auto',
          status: 'claimed',
          device_id: a.deviceId ?? null,
          detail: a.detail ?? null,
          created_at: '',
          claimed_at: '',
          finished_at: null,
          error: null,
        },
        doc: a.orderId ? docOf(a.orderId) : null,
        template: DEFAULT_TEMPLATE,
      };
    },
    claim: async () => ({ status: 'taken' }),
    finish: async (_id, _d, ok, error) => void finished.push({ ok, error }),
    pending: async () => [],
    onJob: () => () => undefined,
  };
  const printer = new Printer(supported ? transport : null, { sleep: async () => undefined });
  setPrintService(new PrintService(api, printer, 'device-test-0001', { render: async () => ({ width: 8, height: 1, bits: new Uint8Array(1) }) }));
}

async function startShift() {
  activateDevice();
  window.history.pushState({}, '', '/');
  render(<App />);
  fireEvent.click(await screen.findByTestId('staff-s1'));
  click('open-shift');
  await screen.findByTestId('queue-screen');
}

/** Giỏ về đơn mới trống (sau Lưu / Thanh toán / Xóa / bỏ chọn). */
async function cartIsNew() {
  await waitFor(() => {
    expect(tid('order-code')).toHaveTextContent('Đơn mới');
    expect(tid('cart-lines').querySelectorAll('li[data-product]')).toHaveLength(0);
  });
}

async function createOrder(productIds = [XOI_GA.id]) {
  await cartIsNew();
  const before = server.openOrders().length;
  for (const p of productIds) {
    click(`menu-product-${p}`);
    click('topping-add');
  }
  click('order-save');
  await waitFor(() => expect(server.openOrders()).toHaveLength(before + 1));
  await cartIsNew();
  return server.openOrders().at(-1)!;
}

const kinds = () => created.map((c) => `${c.kind}:${c.source}`);

beforeEach(() => {
  setEditDelay(0);
});

afterEach(() => {
  resetTablet();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('tablet in phiếu', () => {
  beforeEach(() => {
    useFakeServer();
    usePrinter();
  });

  it('tạo đơn ⇒ tự in phiếu bếp; sửa ⇒ phiếu ĐÃ SỬA có món thêm; thanh toán ⇒ bill', async () => {
    await startShift();
    await waitFor(() => expect(tid('printer-status')).toHaveAttribute('data-state', 'connected'));
    const o = await createOrder();
    await waitFor(() => expect(kinds()).toEqual(['kitchen:auto']));
    expect(created[0]).toMatchObject({ orderId: o.id, deviceId: 'device-test-0001' });
    expect(transport.printedBytes).toBeGreaterThan(0);

    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    expect(await screen.findByTestId('order-code')).toHaveTextContent(o.code);
    click(`menu-product-${XOI_XEO.id}`);
    click('topping-add');
    click('order-deselect');
    await cartIsNew();
    await waitFor(() => expect(kinds()).toEqual(['kitchen:auto', 'kitchen:auto']));
    expect(created[1].detail?.edit).toMatchObject({ added: [{ name: XOI_XEO.name, qty: 1 }], removed: [] });

    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    expect(await screen.findByTestId('order-code')).toHaveTextContent(o.code);
    click('order-pay-exact');
    await cartIsNew();
    await waitFor(() => expect(kinds()).toEqual(['kitchen:auto', 'kitchen:auto', 'bill:auto']));
    expect(finished.every((f) => f.ok)).toBe(true);
    // Tablet không có nút in bill.
    expect(screen.queryByTestId(/bill/i)).toBeNull();
  });

  it('tắt công tắc ⇒ không tự in; nút In lại phiếu bếp trong giỏ vẫn in được', async () => {
    useFakeServer({
      ...CATALOG,
      profile: { ...CATALOG.profile, auto_print_kitchen: false, auto_reprint_kitchen_on_edit: false, auto_print_bill: false },
    });
    await startShift();
    const o = await createOrder();
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    fireEvent.click(await screen.findByTestId('order-reprint'));
    await waitFor(() => expect(kinds()).toEqual(['kitchen:staff']));
    click('order-pay-exact');
    await cartIsNew();
    await new Promise((r) => setTimeout(r, 20));
    expect(kinds()).toEqual(['kitchen:staff']);
  });

  it('máy in lỗi ⇒ đơn vẫn lưu, báo đỏ; In lại; Kết nối lại khi máy in tắt', async () => {
    await startShift();
    await waitFor(() => expect(tid('printer-status')).toHaveAttribute('data-state', 'connected'));
    transport.fail = 'Hết giấy';
    const o = await createOrder();
    expect(server.openOrders()).toHaveLength(1);
    expect(await screen.findByTestId('print-error')).toHaveTextContent(`In phiếu bếp lỗi (đơn ${o.code}): Hết giấy`);
    expect(finished).toEqual([{ ok: false, error: 'Hết giấy' }]);

    transport.fail = null;
    click('print-error-retry');
    await waitFor(() => expect(screen.queryByTestId('print-error')).not.toBeInTheDocument());
    expect(kinds()).toEqual(['kitchen:auto', 'kitchen:staff']);

    transport.drop();
    await waitFor(() => expect(tid('printer-status')).toHaveAttribute('data-state', 'disconnected'));
    click('printer-status');
    click('printer-reconnect');
    await waitFor(() => expect(tid('printer-status')).toHaveAttribute('data-state', 'connected'));
  });

  it('xóa đơn đang chờ in phiếu sửa ⇒ không in', async () => {
    setEditDelay(60_000);
    await startShift();
    const o = await createOrder();
    await waitFor(() => expect(kinds()).toEqual(['kitchen:auto']));
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    expect(await screen.findByTestId('order-code')).toHaveTextContent(o.code);
    click(`menu-product-${XOI_XEO.id}`);
    click('topping-add');
    click('order-deselect');
    await cartIsNew();
    await waitFor(() => expect(server.kinds).toContain('update_order'));
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    fireEvent.click(await screen.findByTestId('order-delete'));
    fireEvent.click(await screen.findByTestId('delete-reason-mistake'));
    await cartIsNew();
    expect(kinds()).toEqual(['kitchen:auto']);
  });
});

describe('PWA (không có máy in)', () => {
  it('không có trạng thái máy in, không có nút in lại, không tạo lệnh', async () => {
    useFakeServer();
    usePrinter({ supported: false });
    await startShift();
    const o = await createOrder();
    expect(screen.queryByTestId('printer-status')).toBeNull();
    click(`queue-card-${o.id}`);
    expect(await screen.findByTestId('order-deselect')).toBeInTheDocument();
    expect(screen.queryByTestId('order-reprint')).toBeNull();
    expect(created).toEqual([]);
  });
});
