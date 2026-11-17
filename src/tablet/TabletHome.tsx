import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Activation } from '@/sync/db';

interface StaffRow {
  id: string;
  name: string;
}

// Màn chọn nhân viên (mục 7, màn 2). Bước 5 thêm Mở ca, hàng đợi và lưu danh sách để dùng offline.
export function TabletHome({ activation }: { activation: Activation }) {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from('staff')
      .select('id,name')
      .eq('active', true)
      .order('name')
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) setError('Không tải được danh sách nhân viên.');
        else setStaff(data ?? []);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main data-testid="tablet-home" className="mx-auto flex h-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold" data-testid="tablet-name">
          {activation.tablet_name}
        </h1>
        <Link to="/owner" className="btn flex items-center border border-stone-300 bg-white" data-testid="open-owner-mode">
          Chế độ chủ
        </Link>
      </header>

      <section data-testid="staff-picker" className="flex flex-col gap-3">
        <h2 className="text-xl text-stone-600">Ai đứng ca?</h2>
        {error && <p className="text-red-700">{error}</p>}
        {!staff && !error && <p className="text-stone-400">Đang tải…</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {staff?.map((s) => (
            <button key={s.id} type="button" className="btn min-h-[72px] border border-stone-300 bg-white text-2xl" data-testid={`staff-${s.id}`}>
              {s.name}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
