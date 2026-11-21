import { useState } from 'react';
import { Check, CircleAlert, Printer as PrinterIcon, RefreshCw } from 'lucide-react';
import { errorMessage } from '@/app/ui';
import { usePrint } from '@/lib/print';
import type { BtDevice } from '@/print/printer';
import { supabasePrintApi } from '@/print/service';
import { useOwner } from '../OwnerContext';
import { IconTile, Section, TONE, btn } from '../ui';

const STATE: Record<string, { text: string; tone: string; dot: string }> = {
  unpaired: { text: 'Chưa chọn máy in', tone: TONE.gray, dot: 'bg-[#a3a3a3]' },
  disconnected: { text: 'Chưa kết nối', tone: TONE.red, dot: 'bg-[#dc2626]' },
  connecting: { text: 'Đang kết nối…', tone: TONE.amber, dot: 'bg-[#d97706]' },
  connected: { text: 'Đã kết nối', tone: TONE.green, dot: 'bg-success' },
  printing: { text: 'Đang in…', tone: TONE.blue, dot: 'bg-[#2563eb]' },
};

/**
 * Quầy của máy này → Máy in (SPEC 12.1; Figma R34 / T35): chọn máy Bluetooth đã ghép đôi trong Cài đặt Android → In thử.
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
      <Section title="Máy in" testId="printer-section">
        <p className="flex items-start gap-2.5 rounded-xl bg-[#f8f8f8] p-3.5 text-[13px] leading-[19px] text-[#6d6d6d]" data-testid="printer-unsupported">
          <PrinterIcon aria-hidden className="mt-px h-[18px] w-[18px] shrink-0" />
          <span>Máy này không in trực tiếp được. Cài app Android “Laodai POS” trên tablet quầy để in phiếu bếp và bill qua Bluetooth. Từ điện thoại vẫn gửi lệnh in lại / in thử tới quầy được.</span>
        </p>
      </Section>
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

  const st = STATE[printer.device ? printer.state : 'unpaired'] ?? STATE.disconnected;
  const failure = error ?? printer.error;

  return (
    <Section title="Máy in" testId="printer-section">
      <div className="flex items-center gap-3 rounded-xl bg-[#f8f8f8] p-3" data-testid="printer-current" data-state={printer.state}>
        <IconTile icon={PrinterIcon} className="h-10 w-10 rounded-xl" iconClass="h-5 w-5" tone="bg-white text-[#111]" />
        <span className="flex min-w-0 flex-col items-start gap-1">
          <b className="truncate text-[15px] font-semibold leading-[19px]">{printer.device?.name ?? 'Chưa chọn máy in'}</b>
          {printer.device && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-[14px] ${st.tone}`}>
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
              {st.text}
            </span>
          )}
        </span>
      </div>
      {failure && (
        <p role="alert" className="flex items-start gap-2.5 rounded-xl bg-[#fdecec] p-3.5 text-[13px] leading-[19px] text-[#b91c1c]" data-testid="printer-error">
          <CircleAlert aria-hidden className="mt-px h-[18px] w-[18px] shrink-0" />
          {error ?? `In lỗi: ${printer.error}`}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          className={btn('outline', 'min-h-[46px]')}
          disabled={busy}
          onClick={() => void run(async () => setDevices(await service.printer.listPaired()))}
          data-testid="printer-list"
        >
          <RefreshCw aria-hidden className="h-4 w-4" />
          {printer.device ? 'Đổi máy in' : 'Chọn máy in'}
        </button>
        <button
          type="button"
          className={btn('dark')}
          disabled={busy || !printer.device}
          onClick={() =>
            void run(async () => {
              const ok = await service.printLocal({ kind: 'test', orderId: null }, supabasePrintApi(owner.client));
              if (ok) setNotice('Đã in thử.');
              else throw new Error(service.getSnapshot().failure?.message ?? 'In thử lỗi');
            })
          }
          data-testid="printer-test"
        >
          <PrinterIcon aria-hidden className="h-4 w-4" />
          In thử
        </button>
      </div>
      {devices && (
        <div className="flex flex-col overflow-hidden rounded-xl border border-line" data-testid="printer-devices">
          {devices.length === 0 && <p className="px-3.5 py-3 text-[13px] leading-[19px] text-[#888]">Chưa có máy Bluetooth nào được ghép đôi. Ghép máy in trong Cài đặt Android → Bluetooth trước.</p>}
          {devices.map((d, i) => (
            <button
              key={d.address}
              type="button"
              disabled={busy}
              className={`flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-[#f8f8f8] ${i > 0 ? 'border-t border-line' : ''}`}
              onClick={() =>
                void run(async () => {
                  const ok = await service.printer.select(d);
                  setDevices(null);
                  if (ok) setNotice(`Đã chọn ${d.name}. Bấm “In thử” để kiểm tra.`);
                })
              }
              data-testid={`printer-device-${d.address}`}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <b className="truncate text-sm font-semibold leading-[18px]">{d.name}</b>
                <span className="text-xs leading-[15px] text-[#888]">{d.address}</span>
              </span>
              {printer.device?.address === d.address && <Check aria-hidden className="h-[18px] w-[18px] shrink-0 text-brand" />}
            </button>
          ))}
        </div>
      )}
      {notice && (
        <p role="status" className="text-[13px] font-medium text-[#15803d]" data-testid="printer-notice">
          {notice}
        </p>
      )}
    </Section>
  );
}
