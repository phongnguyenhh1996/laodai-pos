import type { ButtonHTMLAttributes, HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { Banknote, Landmark, NotebookPen, Package, Soup, type LucideIcon } from 'lucide-react';
import type { PaymentMethod } from '@/domain/types';

/**
 * Mảnh giao diện kiểu Makaryo dùng chung cho màn nhân viên (Bán hàng, Figma BH1–BH19 / BHP1–BHP13) và chế độ chủ (R / T).
 * Số đo theo khung Figma; chiều cao chữ = line-height "auto" của Be Vietnam Pro (1.265 × cỡ chữ: 12→15, 13→16, 14→18, 15→19, 16→20).
 */

/** Thẻ trắng viền xám bo 16. */
export const card = 'flex flex-col rounded-2xl border border-line bg-white';

/** Màu chip theo sắc thái (nền nhạt + chữ đậm). `orange` = cam thương hiệu. */
export const TONE = {
  green: 'bg-[#e8f7ee] text-[#15803d]',
  amber: 'bg-[#fef5e1] text-[#a16207]',
  blue: 'bg-[#eaf1fe] text-[#1d4ed8]',
  red: 'bg-[#fdecec] text-[#b91c1c]',
  gray: 'bg-[#f8f8f8] text-[#6d6d6d]',
  orange: 'bg-[#ffeee7] text-[#c2380a]',
} as const;
export type Tone = keyof typeof TONE;

/** Ô vuông xám chứa icon (34 / 36 / 40). */
export function IconTile({
  icon: Icon,
  className = 'h-[34px] w-[34px] rounded-[10px]',
  iconClass = 'h-[17px] w-[17px]',
  tone = 'bg-[#f8f8f8] text-[#6d6d6d]',
}: {
  icon: LucideIcon;
  className?: string;
  iconClass?: string;
  tone?: string;
}) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center ${tone} ${className}`}>
      <Icon className={iconClass} />
    </span>
  );
}

/** Huy hiệu nhỏ bo 6, chữ 12 đậm (Figma BH: "Chờ ra món", "12′", "Combo", "Đã lưu"); `small` = chữ 11 ("+10k ship"). */
export function Badge({
  tone,
  icon: Icon,
  small,
  className = '',
  testId,
  children,
  ...rest
}: { tone: Tone; icon?: LucideIcon; small?: boolean; className?: string; testId?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'>) {
  return (
    <span
      {...rest}
      data-testid={testId}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-[3px] font-semibold ${small ? 'text-[11px] leading-[14px]' : 'text-xs leading-[15px]'} ${TONE[tone]} ${className}`}
    >
      {Icon && <Icon aria-hidden className={small ? 'h-[11px] w-[11px] shrink-0' : 'h-3 w-3 shrink-0'} />}
      {children}
    </span>
  );
}

/** Tiêu đề khu vực + số đếm xám: "Đơn đang mở (5 đơn)", "Thực đơn (6 món)"; `small` = tiêu đề nhóm "Combo (2)". */
export function AreaTitle({ title, count, small, right }: { title: ReactNode; count?: ReactNode; small?: boolean; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h2 className={`flex min-w-0 items-baseline font-bold tracking-normal text-[#111] ${small ? 'gap-1.5 text-[15px] leading-[19px]' : 'gap-2 text-lg leading-[23px]'}`}>
        <span className="truncate">{title}</span>
        {count !== undefined && <span className="num shrink-0 text-[13px] font-normal leading-4 text-[#888]">({count})</span>}
      </h2>
      {right}
    </div>
  );
}

export interface SegmentOption<K extends string> {
  key: K;
  label: ReactNode;
  icon?: LucideIcon;
  /** Chấm màu trước nhãn (class nền, vd. `bg-[#f59e0b]`). */
  dot?: string;
  /** Số đếm dạng viên sau nhãn (chip lọc dải đơn). */
  count?: number;
  testId?: string;
  countTestId?: string;
  disabled?: boolean;
}

/**
 * Nút phân đoạn kiểu Makaryo: nền xám, nút đang chọn nền trắng + đổ bóng nhẹ, icon cam. Trạng thái đọc từ `aria-pressed`.
 * `stretch`: các nút chia đều chiều ngang (Tại chỗ / Mang về / Ship, Quán giao / Shipper ngoài), cao 44 (`small` 42).
 * Không `stretch`: nút theo độ dài chữ, có chấm + số đếm (lọc dải đơn), cao 40.
 */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  label,
  stretch,
  small,
  track = 'bg-[#efefef]',
  className = '',
}: {
  options: ReadonlyArray<SegmentOption<K>>;
  value: K | null;
  onChange: (key: K, e: MouseEvent<HTMLButtonElement>) => void;
  /** Tên nhóm cho trình đọc màn hình. */
  label: string;
  stretch?: boolean;
  small?: boolean;
  /** Màu nền rãnh (dải đơn: `bg-[#ececec]`). */
  track?: string;
  className?: string;
}) {
  const text = stretch ? (small ? 'text-[13px] leading-4' : 'text-sm leading-[18px]') : small ? 'text-xs leading-[15px]' : 'text-[13px] leading-4';
  return (
    <div role="group" aria-label={label} className={`rounded-xl p-1 ${track} ${stretch ? 'grid auto-cols-fr grid-flow-col gap-1' : 'inline-flex gap-0.5'} ${className}`}>
      {options.map((o) => {
        const on = o.key === value;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            onClick={(e) => onChange(o.key, e)}
            data-testid={o.testId}
            className={`flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 ${text} ${
              stretch ? 'px-2 py-[9px]' : `shrink-0 py-[7px] ${small ? 'px-2' : 'px-2.5'}`
            } ${on ? 'bg-white font-semibold text-[#111] shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'font-medium text-[#6d6d6d] hover:text-[#111]'}`}
          >
            {Icon && <Icon aria-hidden className={`h-4 w-4 shrink-0 ${on ? 'text-brand' : ''}`} />}
            {o.dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.dot}`} />}
            {o.label}
            {o.count !== undefined && (
              <span data-testid={o.countTestId} className={`num rounded-full px-1.5 text-[11px] font-bold leading-[18px] ${on ? 'bg-[#111] text-white' : 'bg-[#dcdcdc] text-[#6d6d6d]'}`}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Icon + màu + nhãn của từng hình thức thanh toán (Figma: TM xanh lá, CK xanh dương, Ghi nợ vàng). */
export const PAY_METHOD_LOOK: Record<PaymentMethod, { icon: LucideIcon; color: string; label: string; short: string }> = {
  cash: { icon: Banknote, color: 'text-[#16a34a]', label: 'Tiền mặt', short: 'TM' },
  transfer: { icon: Landmark, color: 'text-[#2563eb]', label: 'Chuyển khoản', short: 'CK' },
  debt: { icon: NotebookPen, color: 'text-[#f59e0b]', label: 'Ghi nợ', short: 'Ghi nợ' },
};

/**
 * Ô "Hình thức thanh toán" kiểu Makaryo. Dọc (tablet): ô 48 chứa icon, nhãn đầy đủ bên dưới.
 * `inline` (điện thoại): ô 44 chứa icon + nhãn ngắn (TM / CK / Ghi nợ). Đang chọn: nền cam nhạt, viền cam 1.5.
 * Vai trò / `aria-*` (nút, tab) do màn dùng truyền vào; `aria-label` mặc định là nhãn đầy đủ.
 */
export function PayMethodTile({
  method,
  inline,
  selected,
  className = '',
  ...props
}: { method: PaymentMethod; inline?: boolean; selected?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const { icon: Icon, color, label, short } = PAY_METHOD_LOOK[method];
  const box = selected ? 'border-[1.5px] border-brand bg-[#ffeee7]' : 'border border-line bg-white group-hover:border-[#cfcfcf] group-disabled:border-line';
  const icon = <Icon aria-hidden className={`h-[22px] w-[22px] shrink-0 group-disabled:text-[#c4c4c4] ${color}`} />;
  if (inline) {
    return (
      <button
        type="button"
        aria-label={label}
        {...props}
        className={`group flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl text-sm font-semibold leading-[18px] transition-colors duration-fast disabled:cursor-not-allowed disabled:text-[#a3a3a3] ${box} ${selected ? 'text-[#c2380a]' : 'text-[#111]'} ${className}`}
      >
        {icon}
        {short}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      {...props}
      className={`group flex min-w-0 flex-col items-center gap-1.5 text-[13px] leading-4 disabled:cursor-not-allowed disabled:text-[#a3a3a3] ${selected ? 'font-semibold text-[#c2380a]' : 'font-medium text-[#6d6d6d]'} ${className}`}
    >
      <span className={`flex h-12 w-full items-center justify-center rounded-xl transition-colors duration-fast ${box}`}>{icon}</span>
      {label}
    </button>
  );
}

/** Tay nắm 40×4 ở đầu sheet (tóm tắt giỏ, sheet điện thoại). */
export function SheetHandle({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`mx-auto block h-1 w-10 shrink-0 rounded-full bg-[#dadada] ${className}`} />;
}

/**
 * Ô ảnh món (chưa có ảnh thật): nền xám + icon món / combo. `tint`: combo tô cam nhạt (thẻ món ở thực đơn).
 * Cỡ: thẻ món cao 64 (`h-16 w-full rounded-[10px]`, icon 26), dòng giỏ 52 (mặc định), giỏ điện thoại 44 (icon 20).
 */
export function ItemThumb({ combo, tint, className = 'h-[52px] w-[52px] rounded-xl', iconClass = 'h-6 w-6' }: { combo?: boolean; tint?: boolean; className?: string; iconClass?: string }) {
  return <IconTile icon={combo ? Package : Soup} className={className} iconClass={iconClass} tone={combo && tint ? 'bg-[#ffeee7] text-brand' : 'bg-[#f4f4f4] text-[#c4c4c4]'} />;
}

/**
 * Nút màn nhân viên (Figma BH): chữ 15 đậm cao 45, `lg` chữ 16 cao 50 (nút chính "Thu đủ tiền mặt").
 * primary = cam, secondary = viền trắng, danger = đỏ nhạt (xóa), dangerSolid = đỏ ("Bỏ thay đổi"). Tắt = xám cho mọi kiểu.
 */
export const STAFF_BTN = {
  base: 'inline-flex select-none items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors duration-fast disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#efefef] disabled:text-[#a3a3a3] disabled:shadow-none',
  md: 'min-h-[45px] text-[15px] leading-[19px] [&_svg]:h-[17px] [&_svg]:w-[17px] [&_svg]:shrink-0',
  lg: 'min-h-[50px] text-base leading-5 [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0',
  primary: 'bg-brand text-white hover:bg-brand-strong',
  secondary: 'border border-line bg-white text-[#111] hover:bg-[#f8f8f8]',
  danger: 'bg-[#fdecec] text-[#b91c1c] hover:bg-[#fbdcdc]',
  dangerSolid: 'bg-[#dc2626] text-white hover:bg-[#b91c1c]',
} as const;
export type StaffBtnKind = 'primary' | 'secondary' | 'danger' | 'dangerSolid';
export const staffBtn = (kind: StaffBtnKind, size: 'md' | 'lg' = 'md', extra = '') => `${STAFF_BTN.base} ${STAFF_BTN[size]} ${STAFF_BTN[kind]} ${extra}`;

/** Nút vuông chỉ có icon, viền xám bo 12 (máy in, in lại, ✕, ☰): 40 mặc định, 36 ở đầu sheet điện thoại. Icon do màn dùng chọn cỡ. */
export const iconBtn = (extra = 'h-10 w-10') =>
  `inline-flex shrink-0 items-center justify-center rounded-xl border border-line bg-white text-[#111] transition-colors duration-fast hover:bg-[#f8f8f8] disabled:cursor-not-allowed disabled:opacity-40 ${extra}`;

/**
 * Ô nhập kiểu Makaryo (Figma BH: nhãn / số bàn, địa chỉ giao): cao 45, viền xám bo 12, chữ 15. Có icon 16 bên trái ⇒ thêm `pl-[39px]`
 * và đặt icon bằng {@link FIELD_ICON}. Lỗi (`aria-invalid`) ⇒ viền đỏ.
 */
export const FIELD =
  'h-[45px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] font-medium leading-[19px] text-[#111] outline-none transition-[border-color,box-shadow] duration-fast placeholder:font-normal placeholder:text-[#a3a3a3] focus:border-brand focus:ring-1 focus:ring-inset focus:ring-brand aria-[invalid=true]:border-[#dc2626]';
/** Icon 16 xám đặt trong {@link FIELD} (cha `relative`). */
export const FIELD_ICON = 'pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888]';
