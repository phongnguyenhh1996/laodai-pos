import type { ReactNode } from 'react';
import { Ban, Check, Package, Soup, Store } from 'lucide-react';
import { menuBoard, tabletPoints, type SoldOutSet } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import type { Combo, Point, Product, Topping } from '@/domain/types';
import type { Catalog } from '@/pos';

/**
 * Tab điểm bán + lưới combo / món của điểm đang chọn, dựng từ danh mục đã đồng bộ về máy (mục 4.2).
 * Chỉ có điểm bán thuộc hồ sơ tablet. Topping chọn qua bảng chọn sau khi bấm món.
 *
 * Hết món (mục 4.8): món / combo đang hết bị làm mờ, không bấm được. Nút "Báo hết món" bật chế độ đánh dấu:
 * bấm món / topping để báo hết hoặc bán lại (theo điểm bán đang chọn, chỉ trong hôm nay).
 */
const NOTHING_SOLD_OUT: SoldOutSet = { product: () => false, topping: () => false, combo: () => false };

/** Đánh dấu hết món: có ⇒ hiện nút "Báo hết món". */
export interface SoldOutMarking {
  active: boolean;
  onToggleActive: () => void;
  /** Bấm món / topping trong chế độ đánh dấu: `sold_out` là trạng thái MỚI muốn đặt. */
  onToggle: (kind: 'product' | 'topping', id: string, sold_out: boolean) => void;
  /** Khóa `kind:id` đang gửi lên server. */
  pending: string | null;
}

export function MenuBoard({
  catalog,
  pointId,
  onSelectPoint,
  canSelectPoint = () => true,
  onCombo,
  onProduct,
  soldOut = NOTHING_SOLD_OUT,
  marking,
}: {
  catalog: Catalog;
  pointId: string;
  onSelectPoint: (p: Point) => void;
  canSelectPoint?: (p: Point) => boolean;
  onCombo: (c: Combo) => void;
  onProduct: (p: Product) => void;
  soldOut?: SoldOutSet;
  marking?: SoldOutMarking;
}) {
  const points = tabletPoints(catalog.profile, catalog.points);
  const point = points.find((p) => p.id === pointId);

  if (points.length === 0) {
    return (
      <p data-testid="menu-no-points" className="text-ink-subtle">
        Quầy này chưa có điểm bán nào. Nhờ chủ chọn điểm bán trong Cài đặt.
      </p>
    );
  }

  const board = point ? menuBoard(point.menu_id, catalog.products, catalog.toppings, catalog.combos) : null;
  /** Số món + combo của mỗi điểm bán (dòng phụ trên thẻ điểm bán). */
  const count = (p: Point) => {
    const b = menuBoard(p.menu_id, catalog.products, catalog.toppings, catalog.combos);
    return b.products.length + b.combos.length;
  };

  return (
    <section data-testid="menu-board" className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-2.5 md:gap-3">
        {points.map((p) => {
          const on = p.id === pointId;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={!on && !canSelectPoint(p)}
              onClick={() => onSelectPoint(p)}
              data-testid={`point-tab-${p.id}`}
              className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-line bg-surface py-2 pl-2 pr-3 text-left transition-colors duration-fast hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40 aria-selected:border-brand aria-selected:bg-brand-soft md:min-h-[64px] md:max-w-[200px] md:gap-3 md:pl-2.5 md:pr-4"
            >
              <span aria-hidden className={`icon-tile h-9 w-9 rounded-full md:h-10 md:w-10 ${on ? 'bg-brand text-white' : 'bg-surface-muted text-ink-muted'}`}>
                <Store className="h-[18px] w-[18px] md:h-5 md:w-5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={`truncate text-[15px] md:text-base ${on ? 'font-semibold text-brand-deep' : 'font-medium text-ink'}`}>{p.name}</span>
                <span className={`num text-xs md:text-[13px] ${on ? 'text-brand-deep' : 'text-ink-subtle'}`}>{count(p)} món</span>
              </span>
            </button>
          );
        })}
      </div>

      {board && point && marking && (
        <div className="flex flex-wrap items-center gap-3">
          {marking.active ? (
            <p data-testid="soldout-banner" role="status" className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-warning-line bg-warning-soft px-3 py-2.5 text-base font-medium text-warning-strong">
              <Ban aria-hidden className="h-5 w-5 shrink-0" />
              <span>
                Bấm món / topping để báo <b>hết</b> hoặc <b>bán lại</b> ở {point.name} (hôm nay)
              </span>
            </p>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={marking.onToggleActive}
            aria-pressed={marking.active}
            data-testid="soldout-toggle"
            className={`btn min-h-[48px] shrink-0 ${marking.active ? 'btn-primary' : 'btn-secondary'}`}
          >
            {marking.active ? <Check aria-hidden className="h-5 w-5" /> : <Ban aria-hidden className="h-5 w-5" />}
            {marking.active ? 'Xong' : 'Báo hết món'}
          </button>
        </div>
      )}

      {board && point && (
        <div role="tabpanel" data-testid="menu-panel" data-point={point.id} className="flex flex-col gap-4">
          {board.combos.length > 0 && !marking?.active && (
            <Grid title="Combo" count={board.combos.length} cols="grid-cols-2 lg:grid-cols-3">
              {board.combos.map(({ combo, price }) => (
                <Tile
                  key={combo.id}
                  testId={`menu-combo-${combo.id}`}
                  name={combo.name}
                  tag="Combo"
                  price={price}
                  onClick={() => onCombo(combo)}
                  combo
                  soldOut={soldOut.combo(combo)}
                />
              ))}
            </Grid>
          )}
          <Grid title="Món" count={board.products.length} cols="grid-cols-2 lg:grid-cols-4">
            {board.products.map((p) => (
              <Tile
                key={p.id}
                testId={`menu-product-${p.id}`}
                name={p.name}
                tag={point.name}
                price={p.price}
                soldOut={soldOut.product(p.id)}
                marking={marking?.active}
                pending={marking?.pending === `product:${p.id}`}
                onClick={() => (marking?.active ? marking.onToggle('product', p.id, !soldOut.product(p.id)) : onProduct(p))}
              />
            ))}
          </Grid>
          {marking?.active && board.toppings.length > 0 && (
            <Grid title="Topping" count={board.toppings.length} cols="grid-cols-2 lg:grid-cols-4">
              {board.toppings.map((t: Topping) => (
                <Tile
                  key={t.id}
                  testId={`menu-topping-${t.id}`}
                  name={t.name}
                  tag={point.name}
                  price={t.price}
                  soldOut={soldOut.topping(t.id)}
                  marking
                  pending={marking.pending === `topping:${t.id}`}
                  onClick={() => marking.onToggle('topping', t.id, !soldOut.topping(t.id))}
                />
              ))}
            </Grid>
          )}
        </div>
      )}
    </section>
  );
}

function Grid({ title, count, cols, children }: { title: string; count: number; cols: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-baseline gap-2 text-[17px] font-bold md:text-xl">
        {title}
        <span className="num text-base font-normal text-ink-subtle">({count})</span>
      </h3>
      <div className={`grid gap-3 ${cols}`}>{children}</div>
    </div>
  );
}

/**
 * Thẻ món kiểu Makaryo: ô minh họa ở trên, tên, nhãn + giá ở dưới. Combo nền cam nhạt.
 * Đang hết ⇒ mờ + nhãn "Hết"; ngoài chế độ đánh dấu thì không bấm được.
 */
function Tile({
  testId,
  name,
  tag,
  price,
  onClick,
  combo,
  soldOut = false,
  marking = false,
  pending = false,
}: {
  testId: string;
  name: string;
  tag: string;
  price: number;
  onClick: () => void;
  combo?: boolean;
  soldOut?: boolean;
  marking?: boolean;
  pending?: boolean;
}) {
  const Icon = combo ? Package : Soup;
  const disabled = pending || (soldOut && !marking);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      data-sold-out={soldOut || undefined}
      aria-label={soldOut ? `${name} (hết)` : undefined}
      className={`relative flex min-w-0 flex-col gap-2 rounded-2xl border p-2 text-left transition-colors duration-fast disabled:cursor-not-allowed ${
        soldOut
          ? `border-dashed border-line-strong bg-surface-sunken ${marking ? 'hover:border-brand' : ''}`
          : combo
            ? 'border-brand-line bg-brand-soft hover:border-brand active:bg-brand-tint'
            : 'border-line bg-surface hover:border-line-strong active:bg-surface-muted'
      } ${pending ? 'opacity-60' : ''}`}
    >
      {soldOut && (
        <span className="badge absolute right-2.5 top-2.5 z-[1] rounded-md bg-danger px-2 text-xs font-bold text-white" data-testid={`${testId}-soldout`}>
          Hết
        </span>
      )}
      <span
        aria-hidden
        className={`flex w-full items-center justify-center rounded-[10px] ${soldOut ? 'opacity-40 grayscale' : ''} ${combo ? 'h-[64px] bg-brand-tint text-brand md:h-[72px]' : 'h-[72px] bg-surface-muted text-brand-light md:h-[92px]'}`}
      >
        <Icon className="h-8 w-8 md:h-[34px] md:w-[34px]" />
      </span>
      <span className={`flex w-full flex-col gap-1.5 px-1 pb-1 ${soldOut ? 'opacity-55' : ''}`}>
        <span className={`line-clamp-2 text-base font-semibold leading-snug ${soldOut ? 'line-through' : ''}`}>{name}</span>
        <span className="flex items-center gap-1.5">
          <span className={`badge min-w-0 truncate rounded-md px-2 text-xs ${combo ? 'bg-brand-tint text-brand-deep' : 'bg-warning-soft text-warning-strong'}`}>{tag}</span>
          <span className="flex-1" />
          <span className="num shrink-0 text-base font-bold text-ink" data-testid={`${testId}-price`}>
            {formatVnd(price)}
          </span>
        </span>
      </span>
    </button>
  );
}
