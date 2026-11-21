import type { ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { ChevronDown, Search, type LucideIcon } from 'lucide-react';

/** Mảnh giao diện dùng chung cho các màn chế độ chủ kiểu Makaryo (Figma R2x–R3x / T21–T35). */

/** Thẻ trắng viền xám bo 16. */
export const card = 'flex flex-col rounded-2xl border border-line bg-white';

/** Màu chip theo sắc thái. */
export const TONE = {
  green: 'bg-[#e8f7ee] text-[#15803d]',
  amber: 'bg-[#fef5e1] text-[#a16207]',
  blue: 'bg-[#eaf1fe] text-[#1d4ed8]',
  red: 'bg-[#fdecec] text-[#b91c1c]',
  gray: 'bg-[#f8f8f8] text-[#6d6d6d]',
  orange: 'bg-[#ffeee7] text-[#c2380a]',
} as const;
export type Tone = keyof typeof TONE;

/** Tiêu đề trang trong phần nội dung (điện thoại): chữ 22 đậm + dòng phụ xám. */
export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-[22px] font-bold leading-7 tracking-normal">{title}</h2>
        {subtitle && <p className="text-[13px] leading-4 text-[#888]">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

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

/** Ô tìm kiếm cao 44. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  testId,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-3.5 focus-within:border-brand">
      <Search aria-hidden className="h-[18px] w-[18px] shrink-0 text-[#888]" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm leading-[18px] text-[#111] outline-none placeholder:text-[#888] focus-visible:ring-0"
        data-testid={testId}
      />
    </label>
  );
}

/** Ô chọn cao 38: icon trái + chữ + mũi tên; `<select>` gốc trải lên trên (giữ bàn phím / trình đọc màn hình). */
export function SelectBox({ icon: Icon, className = '', ...props }: { icon?: LucideIcon } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative flex h-[38px] min-w-0 items-center rounded-xl border border-line bg-white focus-within:border-brand ${className}`}>
      {Icon && <Icon aria-hidden className="pointer-events-none absolute left-3 h-4 w-4 text-[#6d6d6d]" />}
      <select
        {...props}
        className={`h-full w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-9 text-[13px] font-medium leading-4 text-[#111] outline-none ${Icon ? 'pl-9' : 'pl-3'}`}
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 h-4 w-4 text-[#6d6d6d]" />
    </span>
  );
}

/** Tab gạch chân cam + chip đếm. */
export function UnderlineTabs<K extends string>({
  tabs,
  value,
  onChange,
  testIdPrefix,
}: {
  tabs: Array<{ key: K; label: string; count?: number }>;
  value: K;
  onChange: (k: K) => void;
  testIdPrefix: string;
}) {
  return (
    <div role="tablist" className="flex h-[30px] items-start gap-[18px] overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className="flex shrink-0 flex-col gap-2"
            data-testid={`${testIdPrefix}-${t.key || 'all'}`}
          >
            <span className="flex items-center gap-1.5">
              <span className={`whitespace-nowrap text-sm leading-[18px] ${on ? 'font-semibold text-brand' : 'font-medium text-[#6d6d6d]'}`}>{t.label}</span>
              {t.count !== undefined && (
                <span className={`num rounded-full px-[7px] py-px text-[11px] font-semibold leading-[14px] ${on ? 'bg-[#ffeee7] text-[#c2380a]' : 'bg-[#f8f8f8] text-[#6d6d6d]'}`}>
                  {t.count}
                </span>
              )}
            </span>
            <span aria-hidden className={`h-[3px] w-full rounded-sm ${on ? 'bg-brand' : 'bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
}

/** Nút cao 44–46, chữ 14 đậm (Figma: "In lại bill", "Ca mở đơn", "Sửa đơn"…). */
export const BTN = {
  base: 'inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold leading-[18px] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40',
  dark: 'bg-[#111] text-white hover:bg-black',
  outline: 'border border-line bg-white text-[#111] hover:bg-[#f8f8f8]',
  soft: 'bg-[#ffeee7] text-[#c2380a] hover:bg-[#ffe2d5]',
  brand: 'bg-brand text-white hover:bg-brand-strong',
  danger: 'bg-[#b42318] text-white hover:bg-[#9b1d14]',
} as const;
export const btn = (v: Exclude<keyof typeof BTN, 'base'>, extra = '') => `${BTN.base} ${BTN[v]} ${extra}`;

/** Thẻ có tiêu đề 16 đậm (+ dòng phụ 12 xám). */
export function Section({
  title,
  subtitle,
  right,
  className = '',
  testId,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`${card} gap-3.5 p-4 ${className}`} data-testid={testId}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <h2 className="text-base font-bold leading-5 tracking-normal">{title}</h2>
          {subtitle && <p className="text-xs leading-[17px] text-[#888]">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Dòng nhãn xám ↔ giá trị đậm (thẻ "Thời gian"). */
export function KV({
  label,
  children,
  testId,
  roomy,
}: {
  label: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Dòng cao 34 (thẻ "Tiền mặt") thay vì 30. */ roomy?: boolean;
}) {
  return (
    <p className={`flex items-center justify-between gap-2.5 text-sm leading-[18px] ${roomy ? 'py-2' : 'py-1.5'}`} data-testid={testId}>
      <span className="text-[#6d6d6d]">{label}</span>
      <b className="num text-right font-semibold">{children}</b>
    </p>
  );
}
