import { describe, expect, it } from 'vitest';
import { itemPackaging, orderPackaging } from './packaging';
import { buildItem } from './pricing';
import { CANH, CHA, COM_GA, DUA, DUI, TRUNG, XOI_GA, XOI_XEO, product } from './fixtures';

const norms = new Map([XOI_GA, XOI_XEO, COM_GA].map((p) => [p.id, p]));

describe('packaging', () => {
  it('xôi mang về và tại chỗ: mỗi phần 1 hộp, không dĩa', () => {
    const it1 = buildItem('i', XOI_GA, [TRUNG, CHA], 1);
    expect(itemPackaging(it1, XOI_GA, 'takeaway')).toEqual({ boxes: 1, plates: 0, cans: 0 });
    expect(itemPackaging(it1, XOI_GA, 'dinein')).toEqual({ boxes: 1, plates: 0, cans: 0 });
  });

  it('cơm mang về: 1 hộp + 1 hộp mỗi topping có cờ', () => {
    expect(itemPackaging(buildItem('i', COM_GA, []), COM_GA, 'takeaway')).toEqual({ boxes: 1, plates: 0, cans: 0 });
    expect(itemPackaging(buildItem('i', COM_GA, [CANH]), COM_GA, 'takeaway')).toEqual({ boxes: 2, plates: 0, cans: 0 });
    // 2 topping có cờ + 1 topping không cờ
    expect(itemPackaging(buildItem('i', COM_GA, [CANH, DUA, DUI]), COM_GA, 'takeaway')).toEqual({ boxes: 3, plates: 0, cans: 0 });
  });

  it('đơn ship tính bao bì như mang về', () => {
    expect(itemPackaging(buildItem('i', COM_GA, [CANH, DUI], 2), COM_GA, 'delivery')).toEqual({ boxes: 4, plates: 0, cans: 0 });
  });

  it('cơm tại chỗ: 1 dĩa, 0 hộp, kể cả khi có topping gắn cờ', () => {
    expect(itemPackaging(buildItem('i', COM_GA, [CANH, DUA]), COM_GA, 'dinein')).toEqual({ boxes: 0, plates: 1, cans: 0 });
  });

  it('số lượng > 1 được nhân đúng', () => {
    expect(itemPackaging(buildItem('i', COM_GA, [CANH, DUA], 3), COM_GA, 'takeaway')).toEqual({ boxes: 9, plates: 0, cans: 0 });
    expect(itemPackaging(buildItem('i', COM_GA, [CANH], 4), COM_GA, 'dinein')).toEqual({ boxes: 0, plates: 4, cans: 0 });
    expect(itemPackaging(buildItem('i', XOI_XEO, [], 5), XOI_XEO, 'dinein')).toEqual({ boxes: 5, plates: 0, cans: 0 });
  });

  it('nước lon: qty × số lon mỗi phần, như nhau cho tại chỗ / mang về / ship', () => {
    const coca = product({ id: 'coca', name: 'Coca', boxes_takeaway: 0, boxes_dinein: 0, cans: 1 });
    const it3 = buildItem('i', coca, [], 3);
    expect(itemPackaging(it3, coca, 'dinein')).toEqual({ boxes: 0, plates: 0, cans: 3 });
    expect(itemPackaging(it3, coca, 'takeaway')).toEqual({ boxes: 0, plates: 0, cans: 3 });
    expect(itemPackaging(it3, coca, 'delivery')).toEqual({ boxes: 0, plates: 0, cans: 3 });
  });

  it('cộng bao bì cả đơn (Map hoặc object)', () => {
    const items = [buildItem('a', COM_GA, [CANH], 2), buildItem('b', COM_GA, [], 1)];
    expect(orderPackaging({ dine_type: 'takeaway', items }, norms)).toEqual({ boxes: 5, plates: 0, cans: 0 });
    expect(orderPackaging({ dine_type: 'dinein', items }, Object.fromEntries(norms))).toEqual({ boxes: 0, plates: 3, cans: 0 });
    expect(() => orderPackaging({ dine_type: 'dinein', items: [{ ...items[0], product_id: 'x' }] }, norms)).toThrow();
  });
});
