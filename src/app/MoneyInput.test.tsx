// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MoneyInput } from './MoneyInput';

function Harness({ init = null, onValue }: { init?: number | null; onValue?: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(init);
  return (
    <>
      <MoneyInput
        label="Tiền"
        value={v}
        onChange={(x) => {
          setV(x);
          onValue?.(x);
        }}
        testId="m"
      />
      <button type="button" onClick={() => setV(50_000)}>
        đặt 50k
      </button>
      <button type="button" onClick={() => setV(null)}>
        xóa
      </button>
    </>
  );
}

const input = () => screen.getByTestId('m') as HTMLInputElement;
const type = (raw: string) => fireEvent.change(input(), { target: { value: raw, selectionStart: raw.length } });

describe('MoneyInput (nhập theo nghìn)', () => {
  it('gõ số nghìn ⇒ trả về đồng, hiện dấu chấm và đuôi .000đ', () => {
    const got: Array<number | null> = [];
    render(<Harness onValue={(v) => got.push(v)} />);
    expect(screen.getByText('đ')).toBeInTheDocument(); // ô trống chỉ "0đ"
    type('1500');
    expect(input().value).toBe('1.500');
    expect(screen.getByText('.000đ')).toBeInTheDocument();
    type('0050');
    expect(input().value).toBe('50');
    type('');
    expect(got).toEqual([1_500_000, 50_000, null]);
  });

  it('bỏ ký tự không phải số, không nhận quá 6 chữ số nghìn', () => {
    const got: Array<number | null> = [];
    render(<Harness onValue={(v) => got.push(v)} />);
    type('12a');
    expect(input().value).toBe('12');
    type('999.9999');
    expect(got).toEqual([12_000]);
  });

  it('cha đổi giá trị ⇒ ô hiện theo', () => {
    render(<Harness init={2_080_000} />);
    expect(input().value).toBe('2.080');
    fireEvent.click(screen.getByText('đặt 50k'));
    expect(input().value).toBe('50');
    fireEvent.click(screen.getByText('xóa'));
    expect(input().value).toBe('');
  });

  it('số cũ không chẵn nghìn ⇒ ô trống + báo, không làm tròn ngầm', () => {
    render(<Harness init={25_500} />);
    expect(input().value).toBe('');
    expect(screen.getByTestId('m-legacy')).toHaveTextContent('25.500đ');
    type('26');
    expect(screen.queryByTestId('m-legacy')).toBeNull();
  });
});
