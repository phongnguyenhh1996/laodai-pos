import type { InputHTMLAttributes, ReactNode } from 'react';
import { CircleAlert, LoaderCircle, type LucideIcon } from 'lucide-react';

export function Splash() {
  return (
    <div data-testid="splash" className="flex h-full items-center justify-center gap-3 text-lg text-ink-subtle">
      <LoaderCircle aria-hidden className="h-5 w-5 animate-spin motion-reduce:animate-none" />
      Đang tải…
    </div>
  );
}

/** Ô nhập có nhãn; tùy chọn biểu tượng bên trái và đơn vị bên phải (Makaryo: "0 ……… hộp"). */
export function TextField({
  label,
  icon: Icon,
  suffix,
  ...props
}: { label: string; icon?: LucideIcon; suffix?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      <span className="relative flex items-center">
        {Icon && <Icon aria-hidden className="pointer-events-none absolute left-3.5 h-5 w-5 text-ink-subtle" />}
        <input className={`input ${Icon ? 'pl-11' : ''} ${suffix ? 'pr-14' : ''}`} {...props} />
        {suffix && <span className="pointer-events-none absolute right-4 text-base font-medium text-ink-subtle">{suffix}</span>}
      </span>
    </label>
  );
}

export function ErrorText({ testId, children }: { testId: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      data-testid={testId}
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-base text-danger-strong"
    >
      <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
