// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { Bike, ShoppingBag } from 'lucide-react';
import { PayMethodTile, Segmented, staffBtn } from './kit';

type Dine = 'takeaway' | 'delivery';

function Harness({ onPick }: { onPick?: (k: Dine) => void }) {
  const [v, setV] = useState<Dine>('takeaway');
  return (
    <Segmented<Dine>
      label="Loại đơn"
      stretch
      value={v}
      onChange={(k) => {
        setV(k);
        onPick?.(k);
      }}
      options={[
        { key: 'takeaway', label: 'Mang về', icon: ShoppingBag, testId: 'seg-takeaway' },
        { key: 'delivery', label: 'Ship', icon: Bike, testId: 'seg-delivery', count: 2, countTestId: 'seg-count' },
      ]}
    />
  );
}

describe('Segmented', () => {
  it('đánh dấu nút đang chọn bằng aria-pressed và đổi khi bấm', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    expect(screen.getByRole('group', { name: 'Loại đơn' })).toBeInTheDocument();
    expect(screen.getByTestId('seg-takeaway')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('seg-delivery')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('seg-delivery'));
    expect(onPick).toHaveBeenCalledWith('delivery');
    expect(screen.getByTestId('seg-delivery')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('seg-count')).toHaveTextContent('2');
  });

  it('không chọn nút nào khi value = null', () => {
    render(<Segmented<Dine> label="Lọc" value={null} onChange={() => {}} options={[{ key: 'takeaway', label: 'Mang về', testId: 'a' }]} />);
    expect(screen.getByTestId('a')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('PayMethodTile', () => {
  it('dọc: hiện nhãn đầy đủ; ngang: nhãn ngắn, vẫn đọc tên đầy đủ', () => {
    render(
      <>
        <PayMethodTile method="transfer" data-testid="v" />
        <PayMethodTile method="transfer" inline data-testid="h" />
      </>,
    );
    expect(screen.getByTestId('v')).toHaveTextContent('Chuyển khoản');
    expect(screen.getByTestId('h')).toHaveTextContent('CK');
    expect(screen.getByTestId('h')).toHaveAccessibleName('Chuyển khoản');
  });

  it('nhận vai trò / aria của màn dùng và không bấm được khi tắt', () => {
    const onClick = vi.fn();
    render(<PayMethodTile method="cash" role="tab" aria-selected disabled onClick={onClick} data-testid="t" />);
    const t = screen.getByRole('tab', { name: 'Tiền mặt' });
    expect(t).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(t);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('staffBtn', () => {
  it('ghép lớp theo kiểu và cỡ', () => {
    expect(staffBtn('primary', 'lg')).toContain('bg-brand');
    expect(staffBtn('primary', 'lg')).toContain('min-h-[50px]');
    expect(staffBtn('danger')).toContain('bg-[#fdecec]');
    expect(staffBtn('secondary', 'md', 'w-full')).toMatch(/border-line.*w-full$/);
  });
});
