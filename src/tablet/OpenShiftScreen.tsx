import { useState, useSyncExternalStore } from 'react';
import { CircleAlert, LogIn, UserRound } from 'lucide-react';
import { activeStaff } from '@/domain/catalog';
import { pos, tabletStore } from '@/lib/pos';
import { errorMessage } from '@/app/ui';
import { Notice, useTablet } from './parts';

/** Mở ca (mục 4.1): chọn tên → Mở ca. Không nhập gì thêm; số đầu ca lấy từ hồ sơ tablet. */
export function OpenShiftScreen() {
  const { catalog } = useTablet();
  const snap = useSyncExternalStore(tabletStore.subscribe, tabletStore.getSnapshot);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staff = catalog ? activeStaff(catalog.staff) : null;
  // Chưa tải được danh mục (cần mạng) và lần tải gần nhất lỗi.
  const loadError = !catalog && !!snap.error;
  const chosen = staff?.find((s) => s.id === staffId);

  async function open() {
    if (!catalog || !chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Ca mới ⇒ màn hình tự chuyển sang hàng đợi (mọi máy cùng hồ sơ cũng chuyển theo).
      await pos.openShift({ staff_id: chosen.id });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <main data-testid="open-shift-screen" className="mx-auto flex h-full max-w-4xl flex-col gap-6 overflow-y-auto p-6">
      {loadError && (
        <p data-testid="catalog-error" role="alert" className="flex items-start gap-3 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-lg text-danger-strong">
          <CircleAlert aria-hidden className="mt-1 h-5 w-5 shrink-0" />
          Chưa tải được menu và danh sách nhân viên. Cần có mạng.
        </p>
      )}

      <section data-testid="staff-picker" className="card flex flex-col gap-4 p-6">
        <div>
          <p className="eyebrow">Mở ca</p>
          <h2 className="text-3xl font-bold">Ai đứng ca?</h2>
        </div>
        {!staff && !loadError && <p className="text-ink-subtle">Đang tải…</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {staff?.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === staffId}
              onClick={() => setStaffId(s.id)}
              className="btn btn-choice min-h-[88px] text-2xl"
              data-testid={`staff-${s.id}`}
            >
              <UserRound aria-hidden className="h-6 w-6 opacity-70" />
              {s.name}
            </button>
          ))}
        </div>
      </section>

      <Notice testId="open-shift-error" tone="error">
        {error}
      </Notice>

      <button
        type="button"
        className="btn btn-success min-h-[80px] text-2xl"
        disabled={!chosen || busy}
        onClick={() => void open()}
        data-testid="open-shift"
      >
        <LogIn aria-hidden className="h-7 w-7" />
        {chosen ? `Mở ca – ${chosen.name}` : 'Chọn tên để mở ca'}
      </button>
    </main>
  );
}
