import { useState } from 'react';
import { Printer as PrinterIcon, RefreshCw } from 'lucide-react';
import { usePrint } from '@/lib/print';
import type { PrinterState } from '@/print/printer';
import { IconTile, STAFF_BTN, iconBtn } from '@/app/kit';
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
 * Trạng thái máy in (SPEC 12.1, 12.7; Figma BH1 / BH18 / BHP12): nút icon 40px — tablet ở cuối hàng chip của dải đơn,
 * điện thoại trên header. Chưa sẵn sàng ⇒ nền vàng nhạt, viền vàng, chấm vàng góc. Bấm ⇒ ô chi tiết (BH18 / BHP12): tablet ngay dưới nút, rộng 320; điện thoại dưới header, rộng gần trọn màn (trạng thái, tên máy, "Kết nối lại").
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
        className={
          ok
            ? iconBtn('relative h-10 w-10')
            : 'relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#f59e0b] bg-[#fef5e1] text-[#a16207] transition-colors duration-fast hover:bg-[#fdecc4]'
        }
      >
        <PrinterIcon aria-hidden className="h-[18px] w-[18px]" />
        {!ok && <span aria-hidden className="absolute -right-[3px] -top-[3px] h-3.5 w-3.5 rounded-full border-2 border-white bg-[#f59e0b]" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" aria-hidden onClick={() => setOpen(false)} />
          <div
            data-testid="printer-detail"
            role="dialog"
            aria-label="Máy in"
            className="fixed inset-x-4 top-16 z-30 flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 shadow-[0_12px_32px_rgba(0,0,0,0.16)] md:absolute md:left-auto md:right-0 md:top-full md:mt-1.5 md:w-[320px]"
          >
            <div className="flex items-center gap-3">
              <IconTile icon={PrinterIcon} className="h-10 w-10 rounded-xl" iconClass="h-5 w-5" tone={ok ? 'bg-[#f8f8f8] text-[#6d6d6d]' : 'bg-[#fef5e1] text-[#a16207]'} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] font-bold leading-[19px] text-[#111]" data-testid="printer-detail-state">
                  {STATE_TEXT[printer.state]}
                </span>
                {printer.device && <span className="truncate text-xs leading-[15px] text-[#888]">{printer.device.name}</span>}
              </span>
            </div>
            {printer.state === 'disconnected' && (
              <>
                <p className="text-[13px] leading-[19px] text-[#6d6d6d]">Phiếu bếp sẽ chưa in được. Bật máy in rồi bấm kết nối lại.</p>
                <button
                  type="button"
                  data-testid="printer-reconnect"
                  className={`${STAFF_BTN.base} ${STAFF_BTN.secondary} min-h-[42px] w-full text-sm leading-[18px] [&_svg]:h-4 [&_svg]:w-4`}
                  onClick={() => void service.printer.connect()}
                >
                  <RefreshCw aria-hidden />
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
            className="inline-flex h-7 shrink-0 items-center rounded-[9px] bg-white px-3 text-[13px] font-bold leading-4 text-[#b42318] hover:bg-[#fdecec]"
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
export function ReprintKitchenButton({ orderId, code, testId, className }: { orderId: string; code: string; testId?: string; className?: string }) {
  const { service } = usePrint();
  if (!service.enabled) return null;
  return (
    <button type="button" data-testid={testId} className={iconBtn(className)} aria-label="In lại phiếu bếp" title="In lại phiếu bếp" onClick={() => void service.printKitchen(orderId, code, 'staff')}>
      <PrinterIcon aria-hidden className="h-4 w-4 md:h-[18px] md:w-[18px]" />
    </button>
  );
}
