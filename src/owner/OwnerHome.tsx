import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, BookUser, ChefHat, Clock, ReceiptText, ScrollText, Settings, Timer, Trash2, Users } from 'lucide-react';
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
        <NavItem to="/owner/orders" testId="owner-nav-orders" icon={ReceiptText} title="Đơn" subtitle="Lọc theo ngày / điểm / nhân viên / hình thức / trạng thái · sửa đơn đã thu" />
        <NavItem to="/owner/reports" testId="owner-nav-reports" icon={BarChart3} title="Báo cáo" subtitle="Doanh thu theo ngày / điểm / ca / nhân viên · đối chiếu chuyển khoản · món bán chạy" />
        <NavItem to="/owner/shifts" testId="owner-nav-shifts" icon={Users} title="Ca" subtitle="Đối soát từng ca · đơn của ca · bổ sung hộp / dĩa / tiền giữa ca" />
        <NavItem to="/owner/debts" testId="owner-nav-debts" icon={BookUser} title="Sổ nợ" subtitle="Dư nợ từng khách · lịch sử · chuyển nợ · ghi thu nợ" />
        <NavItem to="/owner/log" testId="owner-nav-log" icon={ScrollText} title="Nhật ký" subtitle="Mọi thao tác: lọc theo loại / nhân viên / ngày" />
        <NavItem
          to="/owner/settings"
          testId="owner-nav-settings" icon={Settings}
          title="Cài đặt"
          subtitle="Menu, món, topping, combo, giá · nhân viên · điểm bán · quầy"
        />
      </NavList>
    </OwnerLayout>
  );
}

const LIVE_LABEL: Record<LiveState, string> = { connecting: 'Đang kết nối…', live: 'Trực tiếp', off: 'Mất kết nối trực tiếp · tự làm mới mỗi phút' };

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
      <section className="card flex flex-col gap-3 p-5">
        <p className="flex items-center justify-between gap-3 text-sm">
          <span className="eyebrow">Hôm nay {shortDate(data.date)}</span>
          <span
            data-testid="dash-live"
            data-state={live}
            className={`badge ${live === 'live' ? 'bg-success-soft text-success-strong' : live === 'off' ? 'bg-warning-soft text-warning-strong' : 'bg-surface-sunken text-ink-muted'}`}
          >
            <span aria-hidden className={`dot ${live === 'live' ? 'animate-pulse bg-success motion-reduce:animate-none' : live === 'off' ? 'bg-warning' : 'bg-ink-subtle'}`} />
            {LIVE_LABEL[live]}
          </span>
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-ink-muted">Doanh thu</span>
          <b className="num text-4xl font-bold tracking-tight text-ink" data-testid="dash-revenue">
            {formatVnd(r.total)}
          </b>
          <span className="text-sm text-ink-subtle" data-testid="dash-orders">
            {r.orders} đơn đã thu
          </span>
        </div>
        <p className="num grid grid-cols-3 gap-2 text-sm" data-testid="dash-revenue-split">
          {/* Dấu phân cách chỉ cho trình đọc màn hình: nội dung chữ vẫn là "TM … · CK … · Nợ …". */}
          <Split label="TM" value={formatVnd(r.cash)} tone="bg-success-soft text-success-strong" />
          <span className="sr-only"> · </span>
          <Split label="CK" value={formatVnd(r.transfer)} tone="bg-info-soft text-info" />
          <span className="sr-only"> · </span>
          <Split label="Nợ" value={formatVnd(r.debt)} tone="bg-warning-soft text-warning-strong" />
        </p>
        <ul className="flex flex-col divide-y divide-line border-t border-line">
          {data.by_point.map((p) => (
            <li key={p.point_id} className="flex items-baseline justify-between gap-3 py-2.5" data-testid={`dash-point-${p.point_id}`}>
              <span>
                <span className="font-semibold">{p.point_name}</span>
                <span className="num ml-2 text-sm text-ink-subtle" data-testid={`dash-point-${p.point_id}-transfer`}>
                  CK {formatVnd(p.transfer)}
                </span>
              </span>
              <b className="num" data-testid={`dash-point-${p.point_id}-total`}>
                {formatVnd(p.total)}
              </b>
            </li>
          ))}
        </ul>
        {debtIn > 0 && (
          <p className="num text-sm text-ink-muted" data-testid="dash-debt-collected">
            Thu nợ: TM {formatVnd(data.debt_collected.cash)} · CK {formatVnd(data.debt_collected.transfer)}
          </p>
        )}
        {data.deleted.count > 0 && (
          <Link
            to="/owner/orders?status=deleted"
            className={`inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-2 ${data.deleted.served ? 'text-danger-strong' : 'text-ink-muted'}`}
            data-testid="dash-deleted"
          >
            <Trash2 aria-hidden className="h-4 w-4" />
            Đã xóa {data.deleted.count} đơn ({data.deleted.served} đã ra món)
          </Link>
        )}
      </section>

      <section className="card flex flex-col gap-1 p-5" data-testid="dash-shifts">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <Users aria-hidden className="h-5 w-5 text-ink-subtle" />
          Ca đang mở ({data.open_shifts.length})
        </h2>
        {data.open_shifts.length === 0 && <p className="text-ink-subtle">Không có ca nào đang mở.</p>}
        {data.open_shifts.map((s) => (
          <Link
            key={s.shift_id}
            to={`/owner/shifts/${s.shift_id}`}
            className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface-muted"
            data-testid={`dash-shift-${s.shift_id}`}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="dot bg-success" />
              {s.staff_name} – {s.tablet_name}
            </span>
            <span className="num flex items-center gap-1 text-sm text-ink-subtle">
              <Clock aria-hidden className="h-4 w-4" />
              từ {hhmm(s.opened_at)}
            </span>
          </Link>
        ))}
      </section>

      <section className="card flex flex-col gap-2 p-5" data-testid="dash-waiting">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <ChefHat aria-hidden className="h-5 w-5 text-ink-subtle" />
          Đơn đang chờ <span className="badge num bg-surface-sunken text-base" data-testid="dash-active-count">{data.active_orders.length}</span>
          {waiting.length > 0 && <span className="badge bg-danger-soft text-danger-strong">{waiting.length} chờ lâu</span>}
        </h2>
        {waiting.map((o) => (
          <Link
            key={o.id}
            to={`/owner/orders/${o.id}`}
            data-testid={`dash-wait-${o.id}`}
            data-color={o.color}
            className={`flex items-center justify-between gap-3 rounded-xl border border-l-4 px-3 py-2 ${o.color === 'red' ? 'border-danger-line border-l-danger bg-danger-soft text-danger-strong' : 'border-warning-line border-l-warning bg-warning-soft text-warning-strong'}`}
          >
            <span className="min-w-0">
              <b>Đơn #<span className="font-mono">{o.code}</span></b> {o.label ? `· ${o.label} ` : ''}· {o.point_name} · {o.tablet_name}
            </span>
            <span className="num flex shrink-0 items-center gap-1 font-semibold">
              <Timer aria-hidden className="h-4 w-4" />
              {Math.floor(minutesBetween(o.created_at, now))} phút
            </span>
          </Link>
        ))}
        {data.active_orders.length > 0 && waiting.length === 0 && <p className="text-ink-subtle">Không có đơn chờ ra món lâu.</p>}
      </section>
    </div>
  );
}

function Split({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className={`flex flex-col rounded-xl px-3 py-2 ${tone}`}>
      <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</span>{' '}
      <span className="font-semibold">{value}</span>
    </span>
  );
}
