import { useState, type ReactNode } from 'react';
import { menuBoard, tabletPoints } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import type { Catalog } from '@/sync';

/**
 * Tab điểm bán + bảng combo / món / topping của điểm đang chọn, dựng từ danh mục đã đồng bộ về máy.
 * Chỉ có điểm bán thuộc hồ sơ tablet (mục 4.2). Bước 5 dùng chính bảng này làm màn tạo đơn.
 */
export function MenuBoard({ catalog }: { catalog: Catalog }) {
  const points = tabletPoints(catalog.profile, catalog.points);
  const [selected, setSelected] = useState<string | null>(null);
  // Điểm đang chọn bị chủ bỏ khỏi hồ sơ ⇒ về điểm đầu tiên.
  const point = points.find((p) => p.id === selected) ?? points[0];

  if (!point) {
    return (
      <p data-testid="menu-no-points" className="text-stone-500">
        Hồ sơ tablet chưa có điểm bán nào. Nhờ chủ chọn điểm bán trong Cài đặt.
      </p>
    );
  }

  const board = menuBoard(point.menu_id, catalog.products, catalog.toppings, catalog.combos);

  return (
    <section data-testid="menu-board" className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-2">
        {points.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === point.id}
            onClick={() => setSelected(p.id)}
            data-testid={`point-tab-${p.id}`}
            className={`btn flex-1 border ${p.id === point.id ? 'border-amber-700 bg-amber-700 text-white' : 'border-stone-300 bg-white'}`}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div role="tabpanel" data-testid="menu-panel" data-point={point.id} className="flex flex-col gap-4">
        {board.combos.length > 0 && (
          <Grid title="Combo">
            {board.combos.map(({ combo, price }) => (
              <Tile key={combo.id} testId={`menu-combo-${combo.id}`} name={combo.name} price={price} />
            ))}
          </Grid>
        )}
        <Grid title="Món">
          {board.products.map((p) => (
            <Tile key={p.id} testId={`menu-product-${p.id}`} name={p.name} price={p.price} />
          ))}
        </Grid>
        {board.toppings.length > 0 && (
          <Grid title="Topping">
            {board.toppings.map((t) => (
              <Tile key={t.id} testId={`menu-topping-${t.id}`} name={t.name} price={t.price} small />
            ))}
          </Grid>
        )}
      </div>
    </section>
  );
}

function Grid({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-lg font-medium text-stone-500">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </div>
  );
}

function Tile({ testId, name, price, small }: { testId: string; name: string; price: number; small?: boolean }) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-col justify-center rounded-xl border border-stone-200 bg-white px-4 ${small ? 'min-h-tap py-2' : 'min-h-[72px] py-3'}`}
    >
      <span className={small ? 'text-lg' : 'text-xl font-semibold'}>{name}</span>
      <span className="text-base text-stone-600" data-testid={`${testId}-price`}>
        {formatVnd(price)}
      </span>
    </div>
  );
}
