import { useOwner } from './OwnerContext';

// Bước 4 / 9 sẽ thêm Cài đặt, Ca, Đơn, Báo cáo, Sổ nợ, Nhật ký.
export function OwnerHome() {
  const owner = useOwner();
  return (
    <main data-testid="owner-home" className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Chế độ chủ</h1>
          <p className="text-stone-500" data-testid="owner-device">
            {owner.device === 'tablet' ? `Trên ${owner.tabletName} · tự thoát sau 2 phút không thao tác` : owner.email}
          </p>
        </div>
        {owner.device === 'tablet' ? (
          <button type="button" className="btn bg-stone-800 text-white" onClick={owner.leave} data-testid="owner-exit">
            Thoát
          </button>
        ) : (
          <button type="button" className="btn border border-stone-300 bg-white" onClick={owner.leave} data-testid="owner-logout">
            Đăng xuất
          </button>
        )}
      </header>
      <p className="text-stone-500">Tổng quan, ca, đơn, báo cáo, sổ nợ, nhật ký và cài đặt sẽ có ở các bước sau.</p>
    </main>
  );
}
