import type { Activation } from '@/sync/db';

// Bước 5 sẽ thay bằng màn mở ca / hàng đợi.
export function TabletHome({ activation }: { activation: Activation }) {
  return (
    <main data-testid="tablet-home" className="p-6 text-2xl font-semibold">
      {activation.tablet_name}
    </main>
  );
}
