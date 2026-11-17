import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { activeStaff } from '@/domain/catalog';
import { localDb } from '@/lib/localdb';
import { catalogRefresher, ensureSyncStarted, syncRunner } from '@/lib/sync';
import { SyncBadge } from '@/app/SyncBadge';
import { useCatalog, useCatalogStatus } from '@/app/useCatalog';
import type { Activation } from '@/sync/db';
import { MenuBoard } from './MenuBoard';

// Màn chọn nhân viên (mục 7, màn 2) + bảng giá theo điểm bán. Bước 5 thêm Mở ca, hàng đợi, tạo đơn.
export function TabletHome({ activation }: { activation: Activation }) {
  const catalog = useCatalog(localDb);
  const catalogStatus = useCatalogStatus(catalogRefresher);

  // Đồng bộ chạy suốt vòng đời app từ lúc vào màn bán hàng (kể cả khi chuyển sang chế độ chủ): không dừng khi rời màn.
  // Mỗi lần quay lại màn bán hàng (vd. vừa thoát chế độ chủ) thì làm mới danh mục ngay.
  useEffect(() => {
    ensureSyncStarted();
    void catalogRefresher.refresh();
  }, []);

  const cat = catalog.status === 'ready' ? catalog.catalog : undefined;
  const staff = cat ? activeStaff(cat.staff) : null;
  // Chưa từng tải được danh mục (lần đầu cần mạng) và lần tải gần nhất lỗi.
  const loadError = catalog.status === 'ready' && !cat && catalogStatus.lastError && !catalogStatus.loading;

  return (
    <main data-testid="tablet-home" className="mx-auto flex h-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="tablet-name">
            {activation.tablet_name}
          </h1>
          <SyncBadge runner={syncRunner} />
        </div>
        <Link to="/owner" className="btn flex items-center border border-stone-300 bg-white" data-testid="open-owner-mode">
          Chế độ chủ
        </Link>
      </header>

      {loadError && (
        <p data-testid="catalog-error" role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-700">
          Chưa tải được menu và danh sách nhân viên. Cần có mạng cho lần đầu.
        </p>
      )}

      <section data-testid="staff-picker" className="flex flex-col gap-3">
        <h2 className="text-xl text-stone-600">Ai đứng ca?</h2>
        {!staff && !loadError && <p className="text-stone-400">Đang tải…</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {staff?.map((s) => (
            <button key={s.id} type="button" className="btn min-h-[72px] border border-stone-300 bg-white text-2xl" data-testid={`staff-${s.id}`}>
              {s.name}
            </button>
          ))}
        </div>
      </section>

      {cat && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl text-stone-600">Bảng giá</h2>
          <MenuBoard catalog={cat} />
        </section>
      )}
    </main>
  );
}
