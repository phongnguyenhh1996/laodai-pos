import { useState } from 'react';
import { Check, Printer as PrinterIcon } from 'lucide-react';
import { ErrorText, errorMessage } from '@/app/ui';
import { usePrint } from '@/lib/print';
import type { BtDevice } from '@/print/printer';
import { supabasePrintApi } from '@/print/service';
import { useOwner } from '../OwnerContext';

const STATE: Record<string, string> = {
  unpaired: 'Chưa chọn máy in',
  disconnected: 'Chưa kết nối',
  connecting: 'Đang kết nối…',
  connected: 'Đã kết nối',
  printing: 'Đang in…',
};

/**
 * Quầy của máy này → Máy in (SPEC 12.1): chọn máy Bluetooth đã ghép đôi trong Cài đặt Android → In thử.
 * Máy in nhớ theo từng máy (không theo quầy). Chỉ app Android in trực tiếp được.
 */
export function PrinterSection() {
  const owner = useOwner();
  const { service, printer } = usePrint();
  const [devices, setDevices] = useState<BtDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!service.enabled) {
    return (
      <section className="mt-4 flex flex-col gap-3" data-testid="printer-section">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <PrinterIcon aria-hidden className="h-5 w-5" /> Máy in
        </h2>
        <p className="card p-5 text-ink-muted" data-testid="printer-unsupported">
          Máy này không in trực tiếp được. Cài app Android “Laodai POS” trên tablet quầy để in phiếu bếp và bill qua Bluetooth. Từ điện thoại vẫn
          gửi lệnh in lại / in thử tới quầy được.
        </p>
      </section>
    );
  }

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await job();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 flex flex-col gap-3" data-testid="printer-section">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <PrinterIcon aria-hidden className="h-5 w-5" /> Máy in
      </h2>
      <div className="card flex flex-col gap-3 p-5">
        <p className="text-lg" data-testid="printer-current" data-state={printer.state}>
          {printer.device ? `${printer.device.name} · ${STATE[printer.state] ?? printer.state}` : STATE.unpaired}
        </p>
        {printer.error && <p className="text-danger-strong">{printer.error}</p>}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn btn-secondary flex-1"
            disabled={busy}
            onClick={() => void run(async () => setDevices(await service.printer.listPaired()))}
            data-testid="printer-list"
          >
            {printer.device ? 'Đổi máy in' : 'Chọn máy in'}
          </button>
          {printer.device && (
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const ok = await service.printLocal({ kind: 'test', orderId: null }, supabasePrintApi(owner.client));
                  if (ok) setNotice('Đã in thử.');
                  else throw new Error(service.getSnapshot().failure?.message ?? 'In thử lỗi');
                })
              }
              data-testid="printer-test"
            >
              In thử
            </button>
          )}
        </div>
        {devices && (
          <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line" data-testid="printer-devices">
            {devices.length === 0 && <p className="px-4 py-3 text-ink-muted">Chưa có máy Bluetooth nào được ghép đôi. Ghép máy in trong Cài đặt Android → Bluetooth trước.</p>}
            {devices.map((d) => (
              <button
                key={d.address}
                type="button"
                disabled={busy}
                className="flex min-h-tap items-center justify-between gap-3 px-4 py-3 text-left text-lg hover:bg-surface-muted"
                onClick={() =>
                  void run(async () => {
                    const ok = await service.printer.select(d);
                    setDevices(null);
                    if (ok) setNotice(`Đã chọn ${d.name}. Bấm “In thử” để kiểm tra.`);
                  })
                }
                data-testid={`printer-device-${d.address}`}
              >
                <span>
                  {d.name}
                  <span className="block text-sm text-ink-subtle">{d.address}</span>
                </span>
                {printer.device?.address === d.address && <Check aria-hidden className="h-5 w-5" />}
              </button>
            ))}
          </div>
        )}
        {notice && (
          <p role="status" className="text-success-strong" data-testid="printer-notice">
            {notice}
          </p>
        )}
        <ErrorText testId="printer-error">{error}</ErrorText>
      </div>
    </section>
  );
}
