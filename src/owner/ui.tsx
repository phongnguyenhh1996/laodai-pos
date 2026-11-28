import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { Check, ChevronDown, Info, Search, type LucideIcon } from 'lucide-react';
import type { ShipStats } from '@/domain/reconcile';
import { shipStatLines } from '@/domain/report';
import { card } from '@/app/kit';

/** Mảnh giao diện dùng chung cho các màn chế độ chủ kiểu Makaryo (Figma R2x–R3x / T21–T35). Phần dùng chung với màn nhân viên nằm ở `@/app/kit`. */

export { card, IconTile, TONE, type Tone } from '@/app/kit';

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
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)} className="flex shrink-0 flex-col gap-2" data-testid={`${testIdPrefix}-${t.key || 'all'}`}>
            <span className="flex items-center gap-1.5">
              <span className={`whitespace-nowrap text-sm leading-[18px] ${on ? 'font-semibold text-brand' : 'font-medium text-[#6d6d6d]'}`}>{t.label}</span>
              {t.count !== undefined && (
                <span className={`num rounded-full px-[7px] py-px text-[11px] font-semibold leading-[14px] ${on ? 'bg-[#ffeee7] text-[#c2380a]' : 'bg-[#f8f8f8] text-[#6d6d6d]'}`}>{t.count}</span>
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

/** Ô nhập cao 45 (Figma R32 / R33): nhãn 13 xám, icon trái, đơn vị phải ("hộp", "đ"), gợi ý 12 dưới ô. */
export function FormInput({
  label,
  icon: Icon,
  unit,
  hint,
  srLabel,
  className = '',
  ...props
}: {
  label: string;
  icon?: LucideIcon;
  unit?: string;
  hint?: ReactNode;
  /** Ẩn nhãn (vẫn đọc được bằng trình đọc màn hình). */
  srLabel?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label className="flex flex-col gap-1.5">
        <span className={srLabel ? 'sr-only' : 'text-[13px] font-medium leading-4 text-[#6d6d6d]'}>{label}</span>
        <span className="relative flex items-center">
          {Icon && <Icon aria-hidden className="pointer-events-none absolute left-[15px] h-4 w-4 text-[#6d6d6d]" />}
          <input
            {...props}
            className={`h-[45px] w-full min-w-0 rounded-xl border border-line bg-white text-[15px] font-medium leading-[19px] text-[#111] outline-none transition-colors duration-fast placeholder:font-normal placeholder:text-[#a3a3a3] focus:border-brand disabled:bg-[#f8f8f8] disabled:text-[#888] ${
              Icon ? 'pl-[39px]' : 'pl-[15px]'
            } ${unit ? 'pr-12' : 'pr-[15px]'}`}
          />
          {unit && <span className="pointer-events-none absolute right-[15px] text-[13px] leading-4 text-[#888]">{unit}</span>}
        </span>
      </label>
      {hint && <span className="text-xs leading-[17px] text-[#888]">{hint}</span>}
    </div>
  );
}

/** Ô chọn cao 45 cùng kiểu FormInput. */
export function FormSelect({ label, hint, children, ...props }: { label: string; hint?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium leading-4 text-[#6d6d6d]">{label}</span>
        <span className="relative flex items-center">
          <select
            {...props}
            className="h-[45px] w-full min-w-0 cursor-pointer appearance-none truncate rounded-xl border border-line bg-white pl-[15px] pr-10 text-[15px] font-medium leading-[19px] text-[#111] outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-[#f8f8f8] disabled:text-[#888]"
          >
            {children}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-[15px] h-4 w-4 text-[#6d6d6d]" />
        </span>
      </label>
      {hint && <span className="text-xs leading-[17px] text-[#888]">{hint}</span>}
    </div>
  );
}

/** Công tắc 44×26 (Figma R32 "In tự động"): `<input type=checkbox role=switch>` trong suốt phủ lên trên. */
export function Switch({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <span className={`relative inline-flex h-[26px] w-11 shrink-0 ${className}`}>
      <input {...props} type="checkbox" role="switch" className="peer absolute inset-0 z-[1] m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed" />
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-[#dadada] transition-colors duration-fast peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-disabled:opacity-50"
      />
      <span aria-hidden className="absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-fast peer-checked:translate-x-[18px]" />
    </span>
  );
}

/** Ô tích vuông cam (18 / 22): `<input type=checkbox>` trong suốt phủ lên trên. */
export function CheckMark({ className = 'h-[22px] w-[22px] rounded-[7px]', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <input {...props} type="checkbox" className="peer absolute inset-0 z-[1] m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed" />
      <span
        aria-hidden
        className={`absolute inset-0 flex items-center justify-center border border-[#cfcfcf] bg-white text-transparent transition-colors duration-fast peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-disabled:opacity-50 ${className}`}
      >
        <Check className="h-[70%] w-[70%]" strokeWidth={3} />
      </span>
    </span>
  );
}

/** Ghi chú nền màu + icon thông tin (Figma R31 xanh, R33 xám). */
export function Note({ tone = 'blue', children, testId }: { tone?: 'blue' | 'gray'; children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-[19px] ${tone === 'blue' ? 'bg-[#eaf1fe] text-[#1d4ed8]' : 'bg-[#f8f8f8] text-[#6d6d6d]'}`}>
      <Info aria-hidden className="mt-px h-[18px] w-[18px] shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Dòng nhãn xám ↔ giá trị đậm (thẻ "Thời gian"). */
export function KV({ label, children, testId, roomy }: { label: ReactNode; children: ReactNode; testId?: string; /** Dòng cao 34 (thẻ "Tiền mặt") thay vì 30. */ roomy?: boolean }) {
  return (
    <p className={`flex items-center justify-between gap-2.5 text-sm leading-[18px] ${roomy ? 'py-2' : 'py-1.5'}`} data-testid={testId}>
      <span className="text-[#6d6d6d]">{label}</span>
      <b className="num text-right font-semibold">{children}</b>
    </p>
  );
}

/** Thống kê ship (chỉ chủ): các dòng > 0, xếp nối nhau; không có gì ⇒ không hiện. */
export function ShipStatsLine({ stats, testId, className = '' }: { stats: ShipStats | null | undefined; testId: string; className?: string }) {
  const lines = shipStatLines(stats);
  if (lines.length === 0) return null;
  return (
    <span className={`num flex flex-wrap gap-x-3 gap-y-0.5 ${className}`} data-testid={testId}>
      {lines.map((l, i) => (
        <span key={l.key} data-testid={`${testId}-${l.key}`}>
          {i > 0 && <span className="sr-only"> · </span>}
          {l.label} <b className="font-semibold">{l.value}</b>
        </span>
      ))}
    </span>
  );
}
