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
    <main data-testid="open-shift-screen" className="mx-auto flex h-full max-w-4xl flex-col gap-5 overflow-y-auto p-4 md:gap-6 md:p-6">
      {loadError && (
        <p data-testid="catalog-error" role="alert" className="flex items-start gap-3 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-lg text-danger-strong">
          <CircleAlert aria-hidden className="mt-1 h-5 w-5 shrink-0" />
          Chưa tải được menu và danh sách nhân viên. Cần có mạng.
        </p>
      )}

      <section data-testid="staff-picker" className="card flex flex-col gap-5 p-5 md:p-7">
        <div className="flex items-center gap-3">
          <span aria-hidden className="icon-tile h-12 w-12 rounded-full bg-brand-soft text-brand">
            <LogIn className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm text-ink-subtle">Mở ca</p>
            <h2 className="text-2xl font-bold md:text-3xl">Ai đứng ca?</h2>
          </div>
        </div>
        {!staff && !loadError && <p className="text-ink-subtle">Đang tải…</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {staff?.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === staffId}
              onClick={() => setStaffId(s.id)}
              className="btn btn-choice min-h-[80px] justify-start gap-3 px-4 text-xl"
              data-testid={`staff-${s.id}`}
            >
              <span aria-hidden className="icon-tile h-10 w-10 rounded-full bg-brand-tint text-brand-deep">
                <UserRound className="h-5 w-5" />
              </span>
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
        className="btn btn-success min-h-[64px] text-xl"
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
