import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * Khung màn vào chế độ chủ (mật khẩu, mã PIN) theo Figma "T19 / R11 Chủ – Mật khẩu (Makaryo)".
 * Tablet (md+): nửa trái cam (logo, "Chế độ chủ", giới thiệu, chip tự thoát), nửa phải xám chứa `children` ở giữa.
 * Điện thoại: `mobileHeader` ⇒ đầu trang cam, thẻ trắng đè lên mép dưới (R11); không có ⇒ chỉ nền xám (R11b).
 */
export function OwnerAuthShell({
  tabletName,
  mobileHeader = false,
  testId,
  children,
}: {
  tabletName: string;
  mobileHeader?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <main data-testid={testId} className="flex min-h-full flex-col bg-[#f6f6f6] text-[#111] md:flex-row">
      {/* Tablet: nửa trái cam */}
      <aside className="hidden w-[46%] max-w-[540px] shrink-0 flex-col justify-between bg-brand p-10 text-white lg:p-14 md:flex">
        <div className="flex items-center gap-3">
          <Logo className="h-12 w-12 rounded-[14px] text-lg" />
          <span className="text-[22px] font-bold leading-7">Lão Đại</span>
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-bold leading-[1.2] tracking-normal lg:text-[44px] lg:leading-[52px]">Chế độ chủ</h1>
          <p className="max-w-[428px] text-[17px] leading-[26px] text-white/[0.88]">
            Doanh thu, ca, đơn, sổ nợ, lương và cài đặt quán — ngay trên máy bán hàng.
          </p>
        </div>
        <p className="flex items-center gap-2 self-start rounded-xl bg-white/[0.16] px-3.5 py-2.5 text-[13px] font-medium leading-4">
          <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" />
          {tabletName} · tự thoát sau 2 phút không thao tác
        </p>
      </aside>

      {/* Điện thoại: đầu trang cam (R11) */}
      {mobileHeader && (
        <header className="flex flex-col gap-3.5 bg-brand px-6 pb-[72px] pt-[120px] text-white md:hidden">
          <Logo className="h-14 w-14 rounded-2xl text-xl" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-bold leading-[35px] tracking-normal">Chế độ chủ</h1>
            <p className="text-sm leading-[18px] text-white/85">Quản lý quán Lão Đại · {tabletName}</p>
          </div>
        </header>
      )}

      <div
        className={`flex flex-1 flex-col md:items-center md:justify-center md:px-8 md:py-10 ${
          mobileHeader ? '-mt-9 px-4 pb-6 md:mt-0' : 'px-5 pb-7 pt-10'
        }`}
      >
        {children}
      </div>
    </main>
  );
}

function Logo({ className }: { className: string }) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center bg-white font-bold text-brand ${className}`}>
      LĐ
    </span>
  );
}

/** Ghi chú "Tự thoát sau 2 phút không thao tác" cuối thẻ đăng nhập. */
export function IdleNote() {
  return (
    <p className="flex items-center gap-2 rounded-xl bg-[#f8f8f8] px-3 py-2.5 text-xs text-[#6d6d6d]">
      <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" />
      Tự thoát sau 2 phút không thao tác
    </p>
  );
}

/** Nút trong màn chế độ chủ (Makaryo): cao 45–47, chữ 15 đậm vừa, bo 12. */
export const authBtn = 'inline-flex min-h-[45px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40';
export const authBtnPrimary = `${authBtn} bg-brand text-white hover:bg-brand-strong active:bg-brand-deep`;
export const authBtnSecondary = `${authBtn} min-h-[47px] border border-line bg-white text-[#111] hover:bg-surface-muted active:bg-surface-sunken`;
export const authLink = 'self-center text-[13px] font-medium leading-4 text-[#888] underline underline-offset-2 hover:text-[#6d6d6d] disabled:opacity-40';
