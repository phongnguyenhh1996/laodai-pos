import { useLayoutEffect, useRef, useState, type InputHTMLAttributes, type MutableRefObject, type ReactNode } from 'react';
import { CircleAlert, type LucideIcon } from 'lucide-react';
import { formatVnd, thousandsFromInput, thousandsText, toVnd } from '@/domain/money';
import type { Money } from '@/domain/types';

type Rest = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'size' | 'className'>;

export interface MoneyInputProps extends Rest {
  /** Số tiền (đồng). null = ô trống. */
  value: Money | null;
  onChange: (value: Money | null) => void;
  label: string;
  /** Ẩn nhãn (vẫn đọc được bằng trình đọc màn hình). */
  srLabel?: boolean;
  /** `tablet`: ô to của màn nhân viên. `owner`: ô cao 45 của chế độ chủ (như FormInput). */
  size?: 'tablet' | 'owner';
  icon?: LucideIcon;
  hint?: ReactNode;
  /** Viền đỏ (vd. số tiền vượt dư nợ). */
  invalid?: boolean;
  /** Ô nhỏ, chữ số canh giữa (ô "Nhập tay" cạnh các nút tiền nhanh ở thanh toán). */
  center?: boolean;
  testId?: string;
  className?: string;
  /** Để cha đặt con trỏ / cuộn tới ô. */
  inputRef?: MutableRefObject<HTMLInputElement | null>;
}

const SUFFIX = '.000đ';
const textOf = (v: Money | null) => (v === null ? '' : (thousandsText(v) ?? ''));
const vndOf = (text: string) => {
  const k = thousandsFromInput(text);
  return k === null ? null : toVnd(k);
};
const digitsIn = (s: string) => s.replace(/\D/g, '').length;

/**
 * Ô tiền **nhập theo nghìn** (SPEC mục 7): gõ `50` = 50.000đ. Ô hiện phần nghìn có dấu chấm (`1.500`) và đuôi `.000đ`
 * cố định ngay sau chữ số, cùng màu với số đã gõ, nên con trỏ luôn đứng trước đuôi. Ô trống chỉ hiện "0đ" mờ. Chỉ nhận chữ số, tối đa 6 chữ số nghìn.
 * Giá trị cũ không chia hết 1.000 (vd. 25.500đ) không làm tròn ngầm: ô để trống và báo rõ đến khi nhập lại.
 */
export function MoneyInput({ value, onChange, label, srLabel, size = 'tablet', icon: Icon, hint, invalid, center, testId, className = '', inputRef, placeholder = '0', disabled, ...rest }: MoneyInputProps) {
  const [text, setText] = useState(() => textOf(value));
  const [prev, setPrev] = useState(value);
  // Cha đổi giá trị (xóa ô sau khi lưu, chọn nút tiền nhanh…) ⇒ hiện lại theo giá trị mới.
  if (value !== prev) {
    setPrev(value);
    if (value !== vndOf(text)) setText(textOf(value));
  }
  const ref = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) ref.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const legacy = value !== null && thousandsText(value) === null;

  function change(raw: string, at: number) {
    const digits = raw.replace(/\D/g, '');
    const k = digits === '' ? null : thousandsFromInput(digits);
    if (digits !== '' && k === null) {
      // Quá dài: bỏ phím vừa gõ, giữ nguyên số cũ.
      return;
    }
    const next = k === null ? '' : formatVnd(k);
    // Giữ con trỏ sau đúng chữ số nó đang đứng sau (đếm từ phải, vì số 0 đầu và dấu chấm có thể đổi).
    const after = digitsIn(raw.slice(at));
    let pos = next.length;
    for (let seen = 0; pos > 0 && seen < after; pos--) if (/\d/.test(next[pos - 1])) seen++;
    caret.current = pos;
    setText(next);
    setPrev(k === null ? null : toVnd(k));
    onChange(k === null ? null : toVnd(k));
  }

  const tablet = size === 'tablet';
  const box = tablet
    ? `min-h-tap rounded-xl border bg-surface shadow-xs ${center ? 'px-2 text-[15px] font-semibold md:text-[17px]' : 'px-4 text-lg'} focus-within:ring-1 focus-within:ring-inset ${
        invalid ? 'border-danger focus-within:ring-danger' : 'border-line-strong focus-within:border-brand focus-within:ring-brand'
      } ${disabled ? 'bg-surface-sunken text-ink-subtle' : 'text-ink'}`
    : `h-[45px] rounded-xl border px-[15px] text-[15px] font-medium leading-[19px] ${invalid ? 'border-danger' : 'border-line focus-within:border-brand'} ${
        disabled ? 'bg-[#f8f8f8] text-[#888]' : 'bg-white text-[#111]'
      }`;
  const muted = tablet ? 'text-ink-subtle' : 'text-[#a3a3a3]';

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label className="flex flex-col gap-1.5">
        <span className={srLabel ? 'sr-only' : tablet ? 'field-label' : 'text-[13px] font-medium leading-4 text-[#6d6d6d]'}>{label}</span>
        <span className={`flex w-full min-w-0 cursor-text items-center transition-[border-color,box-shadow] duration-fast ${center ? 'justify-center' : ''} ${box}`}>
          {Icon && <Icon aria-hidden className={`pointer-events-none mr-2.5 shrink-0 ${tablet ? 'h-5 w-5 text-ink-subtle' : 'h-4 w-4 text-[#6d6d6d]'}`} />}
          {/* Ô rộng đúng bằng chữ số đang có (ô ẩn cùng ô lưới đo bề ngang), đuôi .000đ nằm ngay sau. */}
          <span className="num grid min-w-0">
            <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">
              {text || placeholder}
            </span>
            <input
              {...rest}
              ref={(el) => {
                ref.current = el;
                if (inputRef) inputRef.current = el;
              }}
              type="text"
              inputMode="numeric"
              size={1}
              autoComplete="off"
              placeholder={placeholder}
              disabled={disabled}
              value={text}
              onChange={(e) => change(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              aria-invalid={invalid || legacy || undefined}
              className={`col-start-1 row-start-1 w-0 min-w-full bg-transparent p-0 outline-none placeholder:font-normal ${tablet ? 'placeholder:text-ink-subtle' : 'placeholder:text-[#a3a3a3]'}`}
              data-testid={testId}
            />
          </span>
          {/* Đã gõ số ⇒ đuôi cùng màu / cỡ chữ với số (thừa hưởng từ ô); ô trống ⇒ cùng màu placeholder. */}
          <span aria-hidden className={`num pointer-events-none shrink-0 ${text ? '' : `font-normal ${muted}`}`}>
            {text ? SUFFIX : 'đ'}
          </span>
        </span>
      </label>
      {legacy && (
        <span role="alert" className={`flex items-center gap-1.5 text-danger-strong ${tablet ? 'text-base' : 'text-xs leading-[17px]'}`} data-testid={testId && `${testId}-legacy`}>
          <CircleAlert aria-hidden className="h-4 w-4 shrink-0" />
          Số {formatVnd(value)}đ không chẵn nghìn – nhập lại.
        </span>
      )}
      {hint && <span className={tablet ? 'text-[15px] text-ink-subtle' : 'text-xs leading-[17px] text-[#888]'}>{hint}</span>}
    </div>
  );
}
