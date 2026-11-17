import { useState } from 'react';
import { activeStaff } from '@/domain/catalog';
import { localDb } from '@/lib/localdb';
import { errorMessage } from '@/app/ui';
import { useCatalogStatus } from '@/app/useCatalog';
import { catalogRefresher } from '@/lib/sync';
import { openShift } from '@/sync';
import { Notice, useTablet } from './parts';

/** Mở ca (mục 4.1): chọn tên → Mở ca. Không nhập gì thêm; số đầu ca lấy từ hồ sơ tablet. */
export function OpenShiftScreen() {
  const { catalog } = useTablet();
  const catalogStatus = useCatalogStatus(catalogRefresher);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staff = catalog ? activeStaff(catalog.staff) : null;
  // Chưa từng tải được danh mục (lần đầu cần mạng) và lần tải gần nhất lỗi.
  const loadError = !catalog && catalogStatus.lastError && !catalogStatus.loading;
  const chosen = staff?.find((s) => s.id === staffId);

  async function open() {
    if (!catalog || !chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Ca mới ⇒ màn hình tự chuyển sang hàng đợi (liveQuery ca hiện tại).
      await openShift(localDb, { staff_id: chosen.id, staff_name: chosen.name, profile: catalog.profile });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <main data-testid="open-shift-screen" className="mx-auto flex h-full max-w-4xl flex-col gap-6 overflow-y-auto p-6">
      {loadError && (
        <p data-testid="catalog-error" role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-700">
          Chưa tải được menu và danh sách nhân viên. Cần có mạng cho lần đầu.
        </p>
      )}

      <section data-testid="staff-picker" className="flex flex-col gap-3">
        <h2 className="text-2xl text-stone-600">Ai đứng ca?</h2>
        {!staff && !loadError && <p className="text-stone-400">Đang tải…</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {staff?.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === staffId}
              onClick={() => setStaffId(s.id)}
              className={`btn min-h-[80px] border text-2xl ${s.id === staffId ? 'border-amber-700 bg-amber-700 text-white' : 'border-stone-300 bg-white'}`}
              data-testid={`staff-${s.id}`}
            >
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
        className="btn min-h-[80px] bg-emerald-700 text-2xl text-white"
        disabled={!chosen || busy}
        onClick={() => void open()}
        data-testid="open-shift"
      >
        {chosen ? `Mở ca – ${chosen.name}` : 'Chọn tên để mở ca'}
      </button>
    </main>
  );
}
