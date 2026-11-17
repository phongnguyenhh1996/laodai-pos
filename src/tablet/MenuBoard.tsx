import type { ReactNode } from 'react';
import { menuBoard, tabletPoints } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import type { Combo, Point, Product } from '@/domain/types';
import type { Catalog } from '@/sync';

/**
 * Tab điểm bán + lưới combo / món của điểm đang chọn, dựng từ danh mục đã đồng bộ về máy (mục 4.2).
 * Chỉ có điểm bán thuộc hồ sơ tablet. Topping chọn qua bảng chọn sau khi bấm món.
 */
export function MenuBoard({
  catalog,
  pointId,
  onSelectPoint,
  canSelectPoint = () => true,
  onCombo,
  onProduct,
}: {
  catalog: Catalog;
  pointId: string;
  onSelectPoint: (p: Point) => void;
  canSelectPoint?: (p: Point) => boolean;
  onCombo: (c: Combo) => void;
  onProduct: (p: Product) => void;
}) {
  const points = tabletPoints(catalog.profile, catalog.points);
  const point = points.find((p) => p.id === pointId);

  if (points.length === 0) {
    return (
      <p data-testid="menu-no-points" className="text-stone-500">
        Hồ sơ tablet chưa có điểm bán nào. Nhờ chủ chọn điểm bán trong Cài đặt.
      </p>
    );
  }

  const board = point ? menuBoard(point.menu_id, catalog.products, catalog.toppings, catalog.combos) : null;

  return (
    <section data-testid="menu-board" className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-2">
        {points.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === pointId}
            disabled={p.id !== pointId && !canSelectPoint(p)}
            onClick={() => onSelectPoint(p)}
            data-testid={`point-tab-${p.id}`}
            className={`btn flex-1 border ${p.id === pointId ? 'border-amber-700 bg-amber-700 text-white' : 'border-stone-300 bg-white'}`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {board && point && (
        <div role="tabpanel" data-testid="menu-panel" data-point={point.id} className="flex flex-col gap-4">
          {board.combos.length > 0 && (
            <Grid title="Combo">
              {board.combos.map(({ combo, price }) => (
                <Tile key={combo.id} testId={`menu-combo-${combo.id}`} name={combo.name} price={price} onClick={() => onCombo(combo)} accent />
              ))}
            </Grid>
          )}
          <Grid title="Món">
            {board.products.map((p) => (
              <Tile key={p.id} testId={`menu-product-${p.id}`} name={p.name} price={p.price} onClick={() => onProduct(p)} />
            ))}
          </Grid>
        </div>
      )}
    </section>
  );
}

function Grid({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-lg font-medium text-stone-500">{title}</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function Tile({ testId, name, price, onClick, accent }: { testId: string; name: string; price: number; onClick: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex min-h-[72px] flex-col items-start justify-center rounded-xl border px-4 py-3 text-left active:scale-[0.98] ${
        accent ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'
      }`}
    >
      <span className="text-xl font-semibold">{name}</span>
      <span className="text-base text-stone-600" data-testid={`${testId}-price`}>
        {formatVnd(price)}
      </span>
    </button>
  );
}
