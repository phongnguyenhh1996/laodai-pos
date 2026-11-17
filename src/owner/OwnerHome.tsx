import { NavItem, NavList, OwnerLayout } from './OwnerLayout';

// Bước 6 / 9 sẽ thêm Tổng quan, Ca, Đơn, Báo cáo, Sổ nợ, Nhật ký.
export function OwnerHome() {
  return (
    <OwnerLayout title="Chế độ chủ" testId="owner-home">
      <NavList>
        <NavItem
          to="/owner/settings"
          testId="owner-nav-settings"
          title="Cài đặt"
          subtitle="Menu, món, topping, combo, giá · nhân viên · điểm bán · hồ sơ tablet"
        />
      </NavList>
      <p className="text-stone-500">Tổng quan, ca, đơn, báo cáo, sổ nợ và nhật ký sẽ có ở các bước sau.</p>
    </OwnerLayout>
  );
}
