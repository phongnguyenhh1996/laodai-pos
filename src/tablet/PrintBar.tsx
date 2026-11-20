import { Printer as PrinterIcon, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { usePrint } from '@/lib/print';
import type { PrinterState } from '@/print/printer';

const STATE_TEXT: Record<PrinterState, string> = {
  unsupported: '',
  unpaired: 'Chưa chọn máy in (chủ chọn trong Chế độ chủ → Quầy của máy này)',
  disconnected: 'Máy in chưa kết nối',
  connecting: 'Đang kết nối máy in…',
  connected: 'Máy in sẵn sàng',
  printing: 'Đang in…',
};

const KIND_TEXT = { kitchen: 'phiếu bếp', bill: 'bill', test: 'phiếu in thử' } as const;

/**
 * Trạng thái máy in trên hàng đợi (SPEC 12.1, 12.7): nhân viên chỉ thấy trạng thái + "Kết nối lại".
 * In lỗi ⇒ dải đỏ (không chặn gì). Phiếu bếp lỗi thì có nút "In lại"; bill lỗi thì chỉ ghi lại (chủ in lại từ xa).
 * Máy không in được trực tiếp (PWA) ⇒ không hiện gì.
 */
export function PrintBar({ canReprint }: { canReprint: (orderId: string) => boolean }) {
  const { service, state, printer } = usePrint();
  if (!service.enabled) return null;
  const ok = printer.state === 'connected' || printer.state === 'printing';
  const f = state.failure;
  return (
    <>
      <div
        data-testid="printer-status"
        data-state={printer.state}
        className={`flex items-center gap-3 rounded-xl border px-4 py-2 text-base ${ok ? 'border-line bg-surface text-ink-muted' : 'border-warning-line bg-warning-soft text-warning-strong'}`}
      >
        <PrinterIcon aria-hidden className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {STATE_TEXT[printer.state]}
          {printer.device && ok ? ` · ${printer.device.name}` : ''}
        </span>
        {printer.state === 'disconnected' && (
          <button type="button" data-testid="printer-reconnect" className="btn btn-secondary min-h-[44px] px-4 text-base" onClick={() => void service.printer.connect()}>
            <RefreshCw aria-hidden className="h-4 w-4" />
            Kết nối lại
          </button>
        )}
      </div>
      {f && (
        <div data-testid="print-error" role="alert" className="flex items-center gap-3 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-lg font-medium text-danger-strong">
          <TriangleAlert aria-hidden className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            In {KIND_TEXT[f.kind]} lỗi{f.orderCode ? ` (đơn ${f.orderCode})` : ''}: {f.message}
          </span>
          {f.kind === 'kitchen' && f.orderId && canReprint(f.orderId) && (
            <button
              type="button"
              data-testid="print-error-retry"
              className="btn btn-danger-outline min-h-[44px] px-4 text-base"
              onClick={() => void service.printKitchen(f.orderId!, f.orderCode ?? '', 'staff')}
            >
              In lại
            </button>
          )}
          <button type="button" data-testid="print-error-dismiss" className="btn btn-secondary h-11 min-h-0 w-11 min-w-0 px-0" aria-label="Ẩn" onClick={() => service.dismissFailure()}>
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}

/** Nút "In lại phiếu bếp" trên thẻ đơn: luôn hiện (bất kể công tắc) khi máy in được trực tiếp. */
export function ReprintKitchenButton({ orderId, code, testId }: { orderId: string; code: string; testId?: string }) {
  const { service } = usePrint();
  if (!service.enabled) return null;
  return (
    <button
      type="button"
      data-testid={testId}
      className="btn btn-secondary h-12 min-h-[48px] w-12 min-w-[48px] shrink-0 px-0"
      aria-label="In lại phiếu bếp"
      title="In lại phiếu bếp"
      onClick={() => void service.printKitchen(orderId, code, 'staff')}
    >
      <PrinterIcon aria-hidden className="h-5 w-5" />
    </button>
  );
}
