import type { InputHTMLAttributes, ReactNode } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';

export function Splash() {
  return (
    <div data-testid="splash" className="flex h-full items-center justify-center gap-3 text-lg text-ink-subtle">
      <LoaderCircle aria-hidden className="h-5 w-5 animate-spin motion-reduce:animate-none" />
      Đang tải…
    </div>
  );
}

export function TextField({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      <input className="input" {...props} />
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
