import type { ReactNode } from 'react';
import { Ban, Check, Store } from 'lucide-react';
import { AreaTitle, Badge, ItemThumb } from '@/app/kit';
import { useIsTablet } from '@/app/useMediaQuery';
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
  cartQty = () => 0,
}: {
  catalog: Catalog;
  pointId: string;
  onSelectPoint: (p: Point) => void;
  canSelectPoint?: (p: Point) => boolean;
  onCombo: (c: Combo) => void;
  onProduct: (p: Product) => void;
  soldOut?: SoldOutSet;
  marking?: SoldOutMarking;
  /** Số phần của món đang có trong giỏ (chấm cam trên thẻ món). */
  cartQty?: (productId: string) => number;
}) {
  const isPhone = !useIsTablet();
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

  /** Nút "Báo hết món" (Figma BH1: chip trắng viền xám cao 34); đang đánh dấu ⇒ nút cam "Xong". */
  const markingToggle = marking && (
    <button
      type="button"
      onClick={marking.onToggleActive}
      aria-pressed={marking.active}
      data-testid="soldout-toggle"
      className={`inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-xl px-[13px] text-[13px] font-semibold leading-4 transition-colors duration-fast ${
        marking.active ? 'bg-brand text-white hover:bg-brand-strong' : 'border border-line bg-white text-[#111] hover:bg-[#f8f8f8]'
      }`}
    >
      {marking.active ? <Check aria-hidden className="h-4 w-4" /> : <Ban aria-hidden className="h-4 w-4" />}
      {marking.active ? 'Xong' : 'Báo hết món'}
    </button>
  );
  /** Điện thoại: nút nằm ở tiêu đề nhóm đầu tiên (Combo, hoặc Món khi không có combo / đang đánh dấu). */
  const showCombos = !!board && board.combos.length > 0 && !marking?.active;
  const phoneAction = (first: boolean) => (isPhone && first ? markingToggle : null);

  return (
    <section data-testid="menu-board" className="flex flex-col gap-3">
      {!isPhone && <AreaTitle title="Thực đơn" count={`${point ? count(point) : 0} món`} right={board && point ? markingToggle : null} />}

      <div role="tablist" className="flex gap-2.5 overflow-x-auto">
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
              className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-xl border border-line bg-white py-2 pl-2 pr-4 text-left transition-colors duration-fast hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40 aria-selected:border-brand aria-selected:bg-[#ffeee7]"
            >
              <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${on ? 'bg-brand text-white' : 'bg-[#f1f1f1] text-[#6d6d6d]'}`}>
                <Store className="h-[18px] w-[18px]" />
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <span className={`truncate text-sm font-semibold leading-[18px] ${on ? 'text-[#c2380a]' : 'text-[#111]'}`}>{p.name}</span>
                <span className={`num text-xs leading-[15px] ${on ? 'text-[#c2380a]' : 'text-[#888]'}`}>{count(p)} món</span>
              </span>
            </button>
          );
        })}
      </div>

      {board && point && marking?.active && (
        <p data-testid="soldout-banner" role="status" className="flex items-center gap-2 rounded-xl border border-warning-line bg-warning-soft px-3 py-2.5 text-sm font-medium text-warning-strong">
          <Ban aria-hidden className="h-[18px] w-[18px] shrink-0" />
          <span>
            Bấm món / topping để báo <b>hết</b> hoặc <b>bán lại</b> ở {point.name} (hôm nay)
          </span>
        </p>
      )}

      {board && point && (
        <div role="tabpanel" data-testid="menu-panel" data-point={point.id} className="flex flex-col gap-3">
          {showCombos && (
            <Grid title="Combo" count={board.combos.length} action={phoneAction(true)}>
              {board.combos.map(({ combo, price }) => (
                <Tile key={combo.id} testId={`menu-combo-${combo.id}`} name={combo.name} tag="Combo" price={price} onClick={() => onCombo(combo)} combo soldOut={soldOut.combo(combo)} />
              ))}
            </Grid>
          )}
          <Grid title="Món" count={board.products.length} action={phoneAction(!showCombos)}>
            {board.products.map((p) => (
              <Tile
                key={p.id}
                testId={`menu-product-${p.id}`}
                name={p.name}
                tag={point.name}
                price={p.price}
                qty={marking?.active ? 0 : cartQty(p.id)}
                soldOut={soldOut.product(p.id)}
                marking={marking?.active}
                pending={marking?.pending === `product:${p.id}`}
                onClick={() => (marking?.active ? marking.onToggle('product', p.id, !soldOut.product(p.id)) : onProduct(p))}
              />
            ))}
          </Grid>
          {marking?.active && board.toppings.length > 0 && (
            <Grid title="Topping" count={board.toppings.length}>
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

/** Nhóm món: tiêu đề "Combo (2)" (+ nút bên phải), lưới 2 cột (điện thoại, khe 10 × 12) / 3 cột (tablet lg, khe 12). */
function Grid({ title, count, action, children }: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <AreaTitle small title={title} count={count} right={action} />
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 md:gap-3 lg:grid-cols-3">{children}</div>
    </div>
  );
}

/**
 * Thẻ món kiểu Makaryo (Figma BH1 / BHP1): thẻ trắng bo 14, ô ảnh 64 (combo nền cam nhạt), tên 14, badge (Combo / điểm bán) + giá.
 * Đang hết ⇒ cả thẻ mờ, badge "Hết" đỏ thay nhãn, giá xám gạch; ngoài chế độ đánh dấu thì không bấm được.
 */
function Tile({
  testId,
  name,
  tag,
  price,
  onClick,
  combo,
  qty = 0,
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
  /** Số phần đang có trong giỏ (0 ⇒ không hiện). */
  qty?: number;
  soldOut?: boolean;
  marking?: boolean;
  pending?: boolean;
}) {
  const disabled = pending || (soldOut && !marking);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      data-sold-out={soldOut || undefined}
      aria-label={soldOut ? `${name} (hết)` : qty > 0 ? `${name} (${qty} trong giỏ)` : undefined}
      className={`relative flex min-w-0 flex-col gap-2 rounded-[14px] border border-line bg-white p-2 text-left transition-colors duration-fast disabled:cursor-not-allowed ${
        soldOut ? `opacity-60 ${marking ? 'hover:border-brand' : ''}` : 'hover:border-line-strong active:bg-[#f8f8f8]'
      } ${pending ? 'opacity-60' : ''}`}
    >
      {qty > 0 && !soldOut && (
        <span
          aria-hidden
          className="num absolute right-3 top-3 z-[1] flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white"
          data-testid={`${testId}-qty`}
        >
          {qty}
        </span>
      )}
      <ItemThumb combo={combo} tint className="h-16 w-full rounded-[10px]" iconClass="h-[26px] w-[26px]" />
      <span className="flex w-full flex-col gap-1.5 px-1 pb-1">
        <span className="line-clamp-2 text-sm font-medium leading-[18px] text-[#111]">{name}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          {soldOut ? (
            <Badge tone="red" testId={`${testId}-soldout`}>
              Hết
            </Badge>
          ) : (
            <Badge tone={combo ? 'orange' : 'gray'} className={`min-w-0 truncate ${combo ? '' : '!bg-[#f1f1f1]'}`}>
              {tag}
            </Badge>
          )}
          <span className="flex-1" />
          <span className={`num shrink-0 text-sm font-bold leading-[18px] ${soldOut ? 'text-[#888] line-through' : 'text-[#111]'}`} data-testid={`${testId}-price`}>
            {formatVnd(price)}
          </span>
        </span>
      </span>
    </button>
  );
}
