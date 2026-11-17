import { NavItem, NavList, OwnerLayout } from './OwnerLayout';

// Bước 6 / 9 sẽ thêm Tổng quan, Đơn, Báo cáo, Sổ nợ, Nhật ký.
export function OwnerHome() {
  return (
    <OwnerLayout title="Chế độ chủ" testId="owner-home">
      <NavList>
        <NavItem
          to="/owner/shifts"
          testId="owner-nav-shifts"
          title="Ca"
          subtitle="Đối soát từng ca · đơn của ca · bổ sung hộp / dĩa / tiền giữa ca"
        />
        <NavItem
          to="/owner/settings"
          testId="owner-nav-settings"
          title="Cài đặt"
          subtitle="Menu, món, topping, combo, giá · nhân viên · điểm bán · hồ sơ tablet"
        />
      </NavList>
      <p className="text-stone-500">Tổng quan, đơn, báo cáo, sổ nợ và nhật ký sẽ có ở các bước sau.</p>
    </OwnerLayout>
  );
}
