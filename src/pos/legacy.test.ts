import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { PosNetworkError, type PosBackend } from './backend';
import { ACTIVATION_KEY, clearActivation, readActivation, writeActivation } from './activation';
import { LEGACY_DB, deleteLegacy, drainLegacyOutbox, readLegacy } from './legacy';
import type { Activation } from './types';

const ACT: Activation = { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: 't', owner_email: 'o@x.vn' };

/** Dựng lại IndexedDB của bản offline (Dexie v1 ⇒ phiên bản IDB 10, cùng tên bảng / khóa). */
async function legacyDb(idb: IDBFactory, outbox: Array<Record<string, unknown>>, withMeta = true): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const r = idb.open(LEGACY_DB, 10);
    r.onupgradeneeded = () => {
      const db = r.result;
      const meta = db.createObjectStore('meta', { keyPath: 'key' });
      const ob = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('orders', { keyPath: 'id' });
      if (withMeta) meta.put({ key: 'activation', value: ACT });
      for (const e of outbox) ob.put(e);
    };
    r.onsuccess = () => {
      r.result.close();
      resolve();
    };
    r.onerror = () => reject(r.error);
  });
}

const op = (seq: number, kind = 'create_order') => ({
  seq, op_id: `op-${seq}`, kind, entity_id: `e-${seq}`, payload: { n: seq }, performed_at: `2026-11-17T0${seq}:00:00.000Z`, attempts: 0, last_error: null,
});

const exists = async (idb: IDBFactory) => (await idb.databases()).some((d) => d.name === LEGACY_DB);

function backend(push: PosBackend['push']): PosBackend {
  return { push, loadCatalog: vi.fn(), loadOpenState: vi.fn(), subscribe: vi.fn() } as unknown as PosBackend;
}

describe('readLegacy', () => {
  it('máy chưa từng chạy bản offline ⇒ null, và không tạo cơ sở dữ liệu', async () => {
    const idb = new IDBFactory();
    expect(await readLegacy(idb)).toBeNull();
    expect(await exists(idb)).toBe(false);
    expect(await readLegacy(undefined)).toBeNull();
  });

  it('đọc hồ sơ kích hoạt + outbox theo thứ tự', async () => {
    const idb = new IDBFactory();
    await legacyDb(idb, [op(2), op(1)]);
    const d = await readLegacy(idb);
    expect(d?.activation).toEqual(ACT);
    expect(d?.outbox.map((e) => e.op_id)).toEqual(['op-1', 'op-2']);
  });

  it('cơ sở dữ liệu không có bảng ⇒ rỗng', async () => {
    const idb = new IDBFactory();
    await new Promise<void>((res) => {
      const r = idb.open(LEGACY_DB, 3);
      r.onsuccess = () => (r.result.close(), res());
    });
    expect(await readLegacy(idb)).toEqual({ activation: null, outbox: [] });
  });
});

describe('drainLegacyOutbox', () => {
  it('gửi nốt từng thao tác (giữ op_id + giờ thực hiện thật), xong thì xóa cơ sở dữ liệu cũ', async () => {
    const idb = new IDBFactory();
    await legacyDb(idb, [op(1, 'open_shift'), op(2), op(3, 'pay_order')]);
    const push = vi.fn<PosBackend['push']>()
      .mockResolvedValueOnce({ status: 'ok' })
      .mockResolvedValueOnce({ status: 'duplicate' })
      .mockResolvedValueOnce({ status: 'rejected', reason: 'x' });
    expect(await drainLegacyOutbox(backend(push), idb)).toEqual({ sent: 2, rejected: 1, remaining: 0 });
    expect(push.mock.calls.map((c) => c[0])).toEqual([1, 2, 3].map((n) => {
      const { seq: _s, attempts: _a, last_error: _l, ...w } = op(n, ['open_shift', 'create_order', 'pay_order'][n - 1]);
      return w;
    }));
    expect(await exists(idb)).toBe(false);
  });

  it('mất mạng giữa chừng ⇒ dừng, giữ nguyên để lần sau gửi tiếp; lỗi khác ⇒ ném', async () => {
    const idb = new IDBFactory();
    await legacyDb(idb, [op(1), op(2)]);
    const push = vi.fn<PosBackend['push']>().mockResolvedValueOnce({ status: 'ok' }).mockRejectedValueOnce(new PosNetworkError('x'));
    expect(await drainLegacyOutbox(backend(push), idb)).toEqual({ sent: 1, rejected: 0, remaining: 1 });
    expect(await exists(idb)).toBe(true);
    await expect(drainLegacyOutbox(backend(vi.fn().mockRejectedValue(new TypeError('bug'))), idb)).rejects.toThrow('bug');
  });

  it('không có gì ⇒ không gửi; outbox trống ⇒ chỉ xóa cơ sở dữ liệu cũ', async () => {
    const idb = new IDBFactory();
    const push = vi.fn();
    expect(await drainLegacyOutbox(backend(push), idb)).toEqual({ sent: 0, rejected: 0, remaining: 0 });
    await legacyDb(idb, [], false);
    expect(await drainLegacyOutbox(backend(push), idb)).toEqual({ sent: 0, rejected: 0, remaining: 0 });
    expect(push).not.toHaveBeenCalled();
    expect(await exists(idb)).toBe(false);
    await deleteLegacy(undefined);
  });
});

describe('activation', () => {
  function mem(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    } as Storage;
  }

  it('ghi / đọc / xóa; dữ liệu hỏng ⇒ null', () => {
    const s = mem();
    expect(readActivation(s)).toBeNull();
    writeActivation(ACT, s);
    expect(readActivation(s)).toEqual(ACT);
    s.setItem(ACTIVATION_KEY, '{"tablet_profile_id":1}');
    expect(readActivation(s)).toBeNull();
    s.setItem(ACTIVATION_KEY, '{oops');
    expect(readActivation(s)).toBeNull();
    clearActivation(s);
    expect(readActivation(s)).toBeNull();
    expect(readActivation(undefined)).toBeNull();
  });
});
