import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useNow } from '@/app/useLive';
import { formatVnd } from '@/domain/money';
import { longWaiting, shortDate } from '@/domain/report';
import { hhmm, minutesBetween } from '@/domain/time';
import { loadDashboard, type Dashboard } from './dashboard/api';
import { useLiveReload, type LiveState } from './live';
import { useOwner } from './OwnerContext';
import { NavItem, NavList, OwnerLayout } from './OwnerLayout';

/** Trang đầu chế độ chủ: Tổng quan hôm nay (realtime) + menu các màn chủ. */
export function OwnerHome() {
  return (
    <OwnerLayout title="Tổng quan" testId="owner-home">
      <DashboardPanel />
      <NavList>
        <NavItem to="/owner/orders" testId="owner-nav-orders" title="Đơn" subtitle="Lọc theo ngày / điểm / nhân viên / hình thức / trạng thái · sửa đơn đã thu" />
        <NavItem to="/owner/reports" testId="owner-nav-reports" title="Báo cáo" subtitle="Doanh thu theo ngày / điểm / ca / nhân viên · đối chiếu chuyển khoản · món bán chạy" />
        <NavItem to="/owner/shifts" testId="owner-nav-shifts" title="Ca" subtitle="Đối soát từng ca · đơn của ca · bổ sung hộp / dĩa / tiền giữa ca" />
        <NavItem to="/owner/debts" testId="owner-nav-debts" title="Sổ nợ" subtitle="Dư nợ từng khách · lịch sử · chuyển nợ · ghi thu nợ" />
        <NavItem to="/owner/log" testId="owner-nav-log" title="Nhật ký" subtitle="Mọi thao tác: lọc theo loại / nhân viên / ngày" />
        <NavItem
          to="/owner/settings"
          testId="owner-nav-settings"
          title="Cài đặt"
          subtitle="Menu, món, topping, combo, giá · nhân viên · điểm bán · hồ sơ tablet"
        />
      </NavList>
    </OwnerLayout>
  );
}

const LIVE_LABEL: Record<LiveState, string> = { connecting: 'Đang kết nối…', live: '● Trực tiếp', off: 'Mất kết nối trực tiếp · tự làm mới mỗi phút' };

function DashboardPanel() {
  const { client } = useOwner();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(15_000);

  const reload = useCallback(() => {
    loadDashboard(client)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [client]);

  useEffect(reload, [reload]);
  const live = useLiveReload(client, ['orders', 'shifts', 'debt_payments'], reload);

  if (!data) return error ? <ErrorText testId="dash-error">{error}</ErrorText> : <Splash />;
  const r = data.revenue;
  const waiting = longWaiting(data.active_orders, now, data.wait);
  const debtIn = data.debt_collected.cash + data.debt_collected.transfer;

  return (
    <div className="flex flex-col gap-3" data-testid="dashboard">
      <ErrorText testId="dash-error">{error}</ErrorText>
      <section className="flex flex-col gap-1 rounded-xl border border-stone-200 bg-white p-4">
        <p className="flex items-baseline justify-between text-sm text-stone-500">
          <span>Hôm nay {shortDate(data.date)}</span>
          <span data-testid="dash-live" data-state={live} className={live === 'live' ? 'text-green-700' : ''}>
            {LIVE_LABEL[live]}
          </span>
        </p>
        <p className="flex items-baseline justify-between">
          <span className="text-stone-600">Doanh thu</span>
          <b className="text-3xl" data-testid="dash-revenue">
            {formatVnd(r.total)}
          </b>
        </p>
        <p className="text-right text-stone-600" data-testid="dash-revenue-split">
          TM {formatVnd(r.cash)} · CK {formatVnd(r.transfer)} · Nợ {formatVnd(r.debt)}
        </p>
        <p className="text-right text-sm text-stone-500" data-testid="dash-orders">
          {r.orders} đơn đã thu
        </p>
        <ul className="mt-2 flex flex-col divide-y divide-stone-100 border-t border-stone-100">
          {data.by_point.map((p) => (
            <li key={p.point_id} className="flex items-baseline justify-between gap-3 py-2" data-testid={`dash-point-${p.point_id}`}>
              <span>
                <span className="font-medium">{p.point_name}</span>
                <span className="ml-2 text-sm text-stone-500" data-testid={`dash-point-${p.point_id}-transfer`}>
                  CK {formatVnd(p.transfer)}
                </span>
              </span>
              <b data-testid={`dash-point-${p.point_id}-total`}>{formatVnd(p.total)}</b>
            </li>
          ))}
        </ul>
        {debtIn > 0 && (
          <p className="text-sm text-stone-600" data-testid="dash-debt-collected">
            Thu nợ: TM {formatVnd(data.debt_collected.cash)} · CK {formatVnd(data.debt_collected.transfer)}
          </p>
        )}
        {data.deleted.count > 0 && (
          <Link to="/owner/orders?status=deleted" className={`text-sm underline ${data.deleted.served ? 'text-red-700' : 'text-stone-600'}`} data-testid="dash-deleted">
            Đã xóa {data.deleted.count} đơn ({data.deleted.served} đã ra món)
          </Link>
        )}
      </section>

      <section className="flex flex-col gap-1 rounded-xl border border-stone-200 bg-white p-4" data-testid="dash-shifts">
        <h2 className="text-lg font-semibold">Ca đang mở ({data.open_shifts.length})</h2>
        {data.open_shifts.length === 0 && <p className="text-stone-500">Không có ca nào đang mở.</p>}
        {data.open_shifts.map((s) => (
          <Link key={s.shift_id} to={`/owner/shifts/${s.shift_id}`} className="flex justify-between py-1 underline-offset-2 active:underline" data-testid={`dash-shift-${s.shift_id}`}>
            <span>
              🟢 {s.staff_name} – {s.tablet_name}
            </span>
            <span className="text-stone-500">từ {hhmm(s.opened_at)}</span>
          </Link>
        ))}
      </section>

      <section className="flex flex-col gap-1 rounded-xl border border-stone-200 bg-white p-4" data-testid="dash-waiting">
        <h2 className="text-lg font-semibold">
          Đơn đang chờ <span data-testid="dash-active-count">{data.active_orders.length}</span>
          {waiting.length > 0 && <span className="ml-2 text-base font-normal text-red-700">· {waiting.length} chờ lâu</span>}
        </h2>
        {waiting.map((o) => (
          <Link
            key={o.id}
            to={`/owner/orders/${o.id}`}
            data-testid={`dash-wait-${o.id}`}
            data-color={o.color}
            className={`flex justify-between rounded-lg px-3 py-2 ${o.color === 'red' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}
          >
            <span>
              <b className="font-mono">{o.code}</b> {o.label ? `· ${o.label} ` : ''}· {o.point_name} · {o.tablet_name}
            </span>
            <span>{Math.floor(minutesBetween(o.created_at, now))} phút</span>
          </Link>
        ))}
        {data.active_orders.length > 0 && waiting.length === 0 && <p className="text-stone-500">Không có đơn chờ ra món lâu.</p>}
      </section>
    </div>
  );
}
