import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookUser, ChevronRight, Printer, ScrollText, Settings, Store, Users, UtensilsCrossed, Wallet, type LucideIcon } from 'lucide-react';
import { hasOwnerPin } from '@/lib/auth';
import { loadOwnerCatalog, type OwnerCatalog } from './settings/api';
import { useOwner } from './OwnerContext';
import { OwnerLayout } from './OwnerLayout';

/**
 * Màn "Thêm" của điện thoại (Figma R40): quầy của máy này, các mục quản lý không có trên thanh tab, cài đặt nhanh.
 * Tablet không cần màn này (thanh bên có đủ mục) nhưng vẫn mở được.
 */
export function OwnerMore() {
  const { client, tabletName, tabletProfileId } = useOwner();
  const [catalog, setCatalog] = useState<OwnerCatalog | null>(null);

  useEffect(() => {
    let alive = true;
    // Chỉ để hiện số món / nhân viên: lỗi thì bỏ qua, các mục vẫn bấm được.
    loadOwnerCatalog(client)
      .then((c) => alive && setCatalog(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client]);

  const profile = catalog?.profiles.find((p) => p.id === tabletProfileId);
  const points = profile ? catalog!.points.filter((p) => profile.point_ids.includes(p.id)).map((p) => p.name) : [];
  const activeStaff = catalog?.staff.filter((s) => s.active) ?? [];
  const pin = hasOwnerPin();

  return (
    <OwnerLayout title="Quản lý" wide testId="owner-more">
      <div className="flex flex-col gap-3.5">
        <Link
          to="/owner/device"
          className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-3.5 hover:border-line-strong"
          data-testid="owner-nav-device"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ffeee7] text-[#c2380a]">
              <Store className="h-[22px] w-[22px]" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs leading-[15px] text-[#888]">Quầy của máy này</span>
              <b className="truncate text-base leading-5">{[tabletName, ...points].join(' · ')}</b>
              <span className={`flex items-center gap-1.5 text-xs leading-[15px] ${pin ? 'text-[#15803d]' : 'text-[#888]'}`}>
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${pin ? 'bg-success' : 'bg-[#c4c4c4]'}`} />
                {pin ? 'Đã cài mã PIN chủ' : 'Chưa cài mã PIN chủ'}
              </span>
            </span>
          </span>
          <ChevronRight aria-hidden className="h-[18px] w-[18px] shrink-0 text-[#888]" />
        </Link>

        <SectionLabel>Quản lý</SectionLabel>
        <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
          <Tile to="/owner/debts" testId="owner-nav-debts" icon={BookUser} tone="bg-[#fef5e1] text-[#a16207]" title="Sổ nợ" text="Dư nợ từng khách · chuyển nợ · thu nợ" />
          <Tile to="/owner/payroll" testId="owner-nav-payroll" icon={Wallet} tone="bg-[#e8f7ee] text-[#15803d]" title="Lương" text="Công theo ca · thưởng / trừ / ứng" />
          <Tile to="/owner/log" testId="owner-nav-log" icon={ScrollText} tone="bg-[#eaf1fe] text-[#1d4ed8]" title="Nhật ký" text="Mọi thao tác theo loại / NV / ngày" />
          <Tile to="/owner/settings" testId="owner-nav-settings" icon={Settings} tone="bg-[#f8f8f8] text-[#6d6d6d]" title="Cài đặt" text="Menu, giá · nhân viên · điểm bán · quầy" />
        </div>

        <SectionLabel>Cài đặt nhanh</SectionLabel>
        <nav className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          <Row
            to="/owner/settings/products"
            icon={UtensilsCrossed}
            title="Menu & món"
            text={
              catalog
                ? `${catalog.products.filter((p) => p.active).length} món · ${catalog.toppings.filter((t) => t.active).length} topping · ${catalog.combos.filter((c) => c.active).length} combo`
                : 'Món, topping, combo, giá'
            }
          />
          <Row
            to="/owner/settings/staff"
            icon={Users}
            title="Nhân viên"
            text={catalog ? `${activeStaff.length} người · ${activeStaff.map((s) => s.name).join(', ')}` : 'Danh sách nhân viên'}
          />
          <Row to="/owner/settings/print-template" icon={Printer} title="Mẫu in" text="Hóa đơn · phiếu bếp" />
        </nav>
      </div>
    </OwnerLayout>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h2 className="text-xs font-semibold uppercase leading-[15px] tracking-normal text-[#888]">{children}</h2>;
}

function Tile({ to, testId, icon: Icon, tone, title, text }: { to: string; testId: string; icon: LucideIcon; tone: string; title: string; text: string }) {
  return (
    <Link to={to} data-testid={testId} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-white p-3.5 hover:border-line-strong">
      <span aria-hidden className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex flex-col gap-0.5">
        <b className="text-[15px] leading-[19px]">{title}</b>
        <span className="text-xs leading-4 text-[#888]">{text}</span>
      </span>
    </Link>
  );
}

function Row({ to, icon: Icon, title, text }: { to: string; icon: LucideIcon; title: string; text: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-3.5 py-3 hover:bg-surface-muted">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f8f8f8] text-[#6d6d6d]">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[15px] font-semibold leading-[19px]">{title}</span>
        <span className="truncate text-xs leading-[15px] text-[#888]">{text}</span>
      </span>
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-[#888]" />
    </Link>
  );
}
