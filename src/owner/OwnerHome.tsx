import { NavItem, NavList, OwnerLayout } from './OwnerLayout';

// Bước 9 sẽ thêm Tổng quan, Đơn, Báo cáo.
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
        <NavItem to="/owner/log" testId="owner-nav-log" title="Nhật ký" subtitle="Mọi thao tác: lọc theo loại / nhân viên / ngày" />
        <NavItem to="/owner/debts" testId="owner-nav-debts" title="Sổ nợ" subtitle="Dư nợ từng khách · lịch sử · chuyển nợ · ghi thu nợ" />
        <NavItem
          to="/owner/settings"
          testId="owner-nav-settings"
          title="Cài đặt"
          subtitle="Menu, món, topping, combo, giá · nhân viên · điểm bán · hồ sơ tablet"
        />
      </NavList>
      <p className="text-stone-500">Tổng quan, đơn và báo cáo sẽ có ở bước sau.</p>
    </OwnerLayout>
  );
}
