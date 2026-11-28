import { describe, expect, it, vi } from 'vitest';
import { FakeTransport, PRINTER_KEY, Printer } from './printer';
import { PrintService, type ClaimResult, type CreateArgs, type CreateResult, type PrintApi, type PrintJob } from './service';
import { sampleDoc } from './layout';
import { DEFAULT_TEMPLATE } from './types';

class MemStorage {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

const DEVICE = 'device-test-0001';
const noSleep = async () => undefined;

function job(over: Partial<PrintJob> = {}): PrintJob {
  return {
    id: 'j1', kind: 'kitchen', order_id: 'o1', tablet_profile_id: 'p1', source: 'auto', status: 'claimed', device_id: DEVICE,
    detail: null, created_at: '', claimed_at: '', finished_at: null, error: null, ...over,
  };
}

function fakeApi() {
  const created: CreateArgs[] = [];
  const finished: Array<{ id: string; ok: boolean; error: string | null | undefined }> = [];
  const claims: string[] = [];
  let onJob: ((j: PrintJob) => void) | null = null;
  const api: PrintApi & { failCreate?: boolean; claimResult?: ClaimResult; pendingJobs: Array<{ id: string; created_at: string }> } = {
    pendingJobs: [],
    async create(a) {
      if (api.failCreate) throw new Error('mất mạng');
      created.push(a);
      const r: CreateResult = { status: 'claimed', job: job({ kind: a.kind, order_id: a.orderId ?? null, detail: a.detail ?? null, id: `j${created.length}` }), doc: sampleDoc(), template: DEFAULT_TEMPLATE };
      return r;
    },
    async claim(id) {
      claims.push(id);
      return api.claimResult ?? { status: 'claimed', job: job({ id, source: 'owner', kind: 'bill' }), doc: sampleDoc(), template: DEFAULT_TEMPLATE };
    },
    async finish(id, _d, ok, error) {
      finished.push({ id, ok, error });
    },
    async pending() {
      return api.pendingJobs;
    },
    onJob(_p, fn) {
      onJob = fn;
      return () => (onJob = null);
    },
  };
  return { api, created, finished, claims, emit: (j: PrintJob) => onJob?.(j) };
}

async function setup({ paired = true } = {}) {
  const storage = new MemStorage();
  const t = new FakeTransport();
  if (paired) storage.setItem(PRINTER_KEY, JSON.stringify(t.devices[0]));
  const printer = new Printer(t, { storage: storage as unknown as Storage, sleep: noSleep, chunkSize: 64 });
  const f = fakeApi();
  const svc = new PrintService(f.api, printer, DEVICE, {
    render: async () => ({ width: 16, height: 2, bits: new Uint8Array(4) }),
  });
  return { storage, t, printer, svc, ...f };
}

describe('máy in', () => {
  it('không có đường truyền (PWA) ⇒ unsupported, dịch vụ không in, không tạo lệnh', async () => {
    const printer = new Printer(null, { storage: new MemStorage() as unknown as Storage });
    expect(printer.getSnapshot().state).toBe('unsupported');
    const f = fakeApi();
    const svc = new PrintService(f.api, printer, DEVICE);
    expect(await svc.printKitchen('o1', 'A30', 'auto')).toBe(false);
    expect(f.created).toEqual([]);
    await expect(printer.listPaired()).rejects.toThrow(/Android/);
  });

  it('nhớ máy in đã chọn trên máy; chưa chọn ⇒ unpaired; chọn ⇒ kết nối; quên ⇒ bỏ', async () => {
    const { t, printer, storage } = await setup({ paired: false });
    expect(printer.getSnapshot().state).toBe('unpaired');
    expect(await printer.select(t.devices[0])).toBe(true);
    expect(printer.getSnapshot()).toMatchObject({ state: 'connected', device: t.devices[0] });
    expect(JSON.parse(storage.getItem(PRINTER_KEY)!)).toEqual(t.devices[0]);
    // Mở lại app: đọc máy in đã nhớ.
    const again = new Printer(t, { storage: storage as unknown as Storage });
    expect(again.getSnapshot()).toMatchObject({ state: 'disconnected', device: t.devices[0] });
    await printer.forget();
    expect(printer.getSnapshot().state).toBe('unpaired');
    expect(storage.getItem(PRINTER_KEY)).toBeNull();
  });

  it('in chia gói, in lần lượt không chồng; mất kết nối ⇒ báo, in lại tự kết nối lại', async () => {
    const { t, printer } = await setup();
    const big = new Uint8Array(150).fill(7);
    await Promise.all([printer.print(big), printer.print(Uint8Array.from([1, 2]))]);
    expect(t.writes.map((w) => w.length)).toEqual([64, 64, 22, 2]);
    t.drop();
    expect(printer.getSnapshot()).toMatchObject({ state: 'disconnected', error: 'Mất kết nối máy in' });
    await printer.print(Uint8Array.from([3]));
    expect(printer.getSnapshot().state).toBe('connected');
  });

  it('không kết nối được / hết giấy ⇒ PrinterError, trạng thái có lý do', async () => {
    const { t, printer } = await setup();
    t.failConnect = 'tắt máy';
    await expect(printer.print(Uint8Array.from([1]))).rejects.toThrow(/tắt máy/);
    expect(printer.getSnapshot().error).toMatch(/Không kết nối được/);
    t.failConnect = null;
    t.fail = 'hết giấy';
    await expect(printer.print(Uint8Array.from([1]))).rejects.toThrow(/hết giấy/);
    expect(printer.getSnapshot()).toMatchObject({ state: 'disconnected', error: 'In lỗi: hết giấy' });
  });
});

describe('dịch vụ in', () => {
  it('in tại chỗ: tạo lệnh (máy nhận luôn) ⇒ in ⇒ báo đã in', async () => {
    const { svc, created, finished, t } = await setup();
    const edit = { at: '2026-11-20T00:22:00Z', added: [], removed: [] };
    expect(await svc.printKitchen('o1', 'A30', 'auto', edit)).toBe(true);
    expect(created).toEqual([{ kind: 'kitchen', orderId: 'o1', orderCode: 'A30', source: 'auto', detail: { edit }, deviceId: DEVICE }]);
    expect(finished).toEqual([{ id: 'j1', ok: true, error: null }]);
    expect(t.printedBytes).toBeGreaterThan(0);
    expect(svc.getSnapshot()).toMatchObject({ busy: false, failure: null, printed: 1 });
  });

  it('in lỗi ⇒ không ném, báo lỗi về server + báo đỏ trên máy; mất mạng khi tạo lệnh cũng không ném', async () => {
    const { svc, finished, t, api } = await setup();
    t.fail = 'hết giấy';
    expect(await svc.printBill('o1', 'A30')).toBe(false);
    expect(finished).toEqual([{ id: 'j1', ok: false, error: 'hết giấy' }]);
    expect(svc.getSnapshot().failure).toMatchObject({ kind: 'bill', orderCode: 'A30', message: 'hết giấy' });
    svc.dismissFailure();
    api.failCreate = true;
    expect(await svc.printKitchen('o2', 'B12', 'staff')).toBe(false);
    expect(svc.getSnapshot().failure).toMatchObject({ orderCode: 'B12', message: 'Không in được: mất mạng' });
  });

  it('lệnh từ xa: chỉ nhận khi máy in đang kết nối; nhận một lần; lệnh đã bị máy khác nhận thì bỏ', async () => {
    const { svc, claims, finished, printer, emit, api } = await setup();
    svc.start('p1');
    await vi.waitFor(() => expect(printer.getSnapshot().state).toBe('connected'));
    emit(job({ id: 'r1', status: 'pending', source: 'owner' }));
    emit(job({ id: 'r1', status: 'pending', source: 'owner' }));
    await vi.waitFor(() => expect(finished).toEqual([{ id: 'r1', ok: true, error: null }]));
    expect(claims).toEqual(['r1']);

    api.claimResult = { status: 'taken' };
    expect(await svc.handleRemote('r2')).toBe(false);
    expect(finished).toHaveLength(1);

    await printer.forget();
    expect(await svc.handleRemote('r3')).toBe(false);
    expect(claims).toEqual(['r1', 'r2']);
    svc.stop();
  });

  it('kết nối lại máy in ⇒ nhận các lệnh đang chờ', async () => {
    const { svc, claims, printer, t, api } = await setup();
    t.failConnect = 'tắt';
    svc.start('p1');
    await vi.waitFor(() => expect(printer.getSnapshot().state).toBe('disconnected'));
    api.pendingJobs = [{ id: 'w1', created_at: '' }, { id: 'w2', created_at: '' }];
    t.failConnect = null;
    await printer.connect();
    await vi.waitFor(() => expect(claims).toEqual(['w1', 'w2']));
    svc.stop();
  });
});
