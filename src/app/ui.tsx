import type { InputHTMLAttributes, ReactNode } from 'react';

export function Splash() {
  return (
    <div data-testid="splash" className="flex h-full items-center justify-center text-stone-400">
      Đang tải…
    </div>
  );
}

export function TextField({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-base font-medium text-stone-600">{label}</span>
      <input
        className="min-h-tap rounded-xl border border-stone-300 bg-white px-4 text-lg outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
        {...props}
      />
    </label>
  );
}

export function ErrorText({ testId, children }: { testId: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p data-testid={testId} role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-base text-red-700">
      {children}
    </p>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
