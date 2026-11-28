import { useState } from 'react';
import { Printer as PrinterIcon, RefreshCw } from 'lucide-react';
import { usePrint } from '@/lib/print';
import type { PrinterState } from '@/print/printer';
import { Toast } from './Toast';

const STATE_TEXT: Record<PrinterState, string> = {
  unsupported: '',
  unpaired: 'Chưa chọn máy in (chủ chọn trong Chế độ chủ → Quầy của máy này)',
  disconnected: 'Máy in chưa kết nối',
  connecting: 'Đang kết nối máy in…',
  connected: 'Máy in sẵn sàng',
  printing: 'Đang in…',
};

const KIND_TEXT = { kitchen: 'phiếu bếp', bill: 'bill', test: 'phiếu in thử' } as const;

/** Toast in lỗi còn hiện bao lâu (lâu hơn toast thường: có nút "In lại"). */
const PRINT_ERROR_MS = 10_000;

/**
 * Trạng thái máy in (SPEC 12.1, 12.7; Figma S18–S19 / P13): nút icon 44px — tablet ở cuối hàng chip của dải đơn,
 * điện thoại trên header. Chưa sẵn sàng ⇒ nút vàng + chấm. Bấm ⇒ ô chi tiết ngay dưới nút (trạng thái, tên máy, "Kết nối lại").
 * Máy không in được trực tiếp (PWA) ⇒ không hiện gì.
 */
export function PrinterButton({ className = '' }: { className?: string }) {
  const { service, printer } = usePrint();
  const [open, setOpen] = useState(false);
  if (!service.enabled) return null;
  const ok = printer.state === 'connected' || printer.state === 'printing';
  return (
    <div className={`relative shrink-0 ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-testid="printer-status"
        data-state={printer.state}
        aria-label={STATE_TEXT[printer.state]}
        aria-expanded={open}
        title={STATE_TEXT[printer.state]}
        onClick={() => setOpen((o) => !o)}
        className={`btn h-11 min-h-0 w-11 min-w-0 rounded-xl px-0 ${ok ? 'btn-secondary text-ink-muted' : 'border border-warning-line bg-warning-soft text-warning-strong'}`}
      >
        <PrinterIcon aria-hidden className="h-5 w-5" />
        {!ok && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-warning" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden onClick={() => setOpen(false)} />
          <div
            data-testid="printer-detail"
            role="dialog"
            aria-label="Máy in"
            className="absolute right-0 top-full z-30 mt-2 flex w-[320px] flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-raised"
          >
            <div className="flex items-center gap-3">
              <span aria-hidden className={`icon-tile h-10 w-10 rounded-full ${ok ? 'bg-surface-muted text-ink-muted' : 'bg-warning-soft text-warning-strong'}`}>
                <PrinterIcon className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-base font-semibold" data-testid="printer-detail-state">
                  {STATE_TEXT[printer.state]}
                </span>
                {printer.device && <span className="truncate text-[13px] text-ink-subtle">{printer.device.name}</span>}
              </span>
            </div>
            {printer.state === 'disconnected' && (
              <>
                <p className="text-sm text-ink-muted">Phiếu bếp sẽ chưa in được. Bật máy in rồi bấm kết nối lại.</p>
                <button type="button" data-testid="printer-reconnect" className="btn btn-secondary min-h-[44px] w-full text-base" onClick={() => void service.printer.connect()}>
                  <RefreshCw aria-hidden className="h-4 w-4" />
                  Kết nối lại
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * In lỗi ⇒ toast (không chặn gì). Phiếu bếp lỗi thì có nút "In lại"; bill lỗi thì chỉ ghi lại (chủ in lại từ xa).
 * In lại được ⇒ toast tự mất (service xóa lỗi).
 */
export function PrintErrorToast({ canReprint }: { canReprint: (orderId: string) => boolean }) {
  const { service, state } = usePrint();
  const f = state.failure;
  if (!service.enabled || !f) return null;
  return (
    <Toast
      key={f.at}
      tone="error"
      testId="print-error"
      ms={PRINT_ERROR_MS}
      onClose={() => service.dismissFailure()}
      actions={
        f.kind === 'kitchen' &&
        f.orderId &&
        canReprint(f.orderId) && (
          <button
            type="button"
            data-testid="print-error-retry"
            className="btn h-9 min-h-0 min-w-0 shrink-0 rounded-lg bg-surface px-3 text-sm font-semibold text-danger-strong"
            onClick={() => void service.printKitchen(f.orderId!, f.orderCode ?? '', 'staff')}
          >
            In lại
          </button>
        )
      }
    >
      In {KIND_TEXT[f.kind]} lỗi{f.orderCode ? ` (đơn ${f.orderCode})` : ''}: {f.message}
    </Toast>
  );
}

/** Nút "In lại phiếu bếp" trong giỏ: luôn hiện (bất kể công tắc) khi máy in được trực tiếp. */
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
