import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Banknote,
  ChefHat,
  ChevronRight,
  CircleAlert,
  Clock,
  HandCoins,
  Landmark,
  Store,
  Timer,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { useNow } from '@/app/useLive';
import { formatVnd } from '@/domain/money';
import { longWaiting, shortDate } from '@/domain/report';
import { hhmm, minutesBetween } from '@/domain/time';
import { loadDashboard, type Dashboard } from './dashboard/api';
import { useLiveReload, type LiveState } from './live';
import { CardHead, Chip, OwnerLayout } from './OwnerLayout';
import { useOwner } from './OwnerContext';

const LIVE_LABEL: Record<LiveState, string> = { connecting: 'Đang kết nối…', live: 'Trực tiếp', off: 'Mất kết nối · tự làm mới mỗi phút' };
const LIVE_TONE: Record<LiveState, [string, string]> = {
  live: ['bg-[#e8f7ee] text-[#15803d]', 'bg-success animate-pulse motion-reduce:animate-none'],
  off: ['bg-[#fef5e1] text-[#a16207]', 'bg-warning'],
  connecting: ['bg-[#f0f0f0] text-[#6d6d6d]', 'bg-ink-subtle'],
};

/** Trang đầu chế độ chủ: Tổng quan hôm nay, cập nhật trực tiếp (Figma R12 / T20). */
export function OwnerHome() {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const liveChip = (
    <Chip testId="dash-live" state={live} className={LIVE_TONE[live][0]}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${LIVE_TONE[live][1]}`} />
      {LIVE_LABEL[live]}
    </Chip>
  );

  return (
    <OwnerLayout title="Tổng quan" subtitle="Số liệu cập nhật trực tiếp" actions={isTablet ? liveChip : undefined} wide testId="owner-home">
      {!data ? (
        error ? <ErrorText testId="dash-error">{error}</ErrorText> : <Splash />
      ) : (
        <>
          {!isTablet && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-[22px] font-bold leading-7 tracking-normal">Hôm nay, {shortDate(data.date)}</h2>
                <p className="text-[13px] leading-4 text-[#888]">Số liệu cập nhật trực tiếp</p>
              </div>
              {liveChip}
            </div>
          )}
          <ErrorText testId="dash-error">{error}</ErrorText>
          <DashboardBody data={data} />
        </>
      )}
    </OwnerLayout>
  );
}

const card = 'flex flex-col rounded-2xl border border-line bg-white';

function DashboardBody({ data }: { data: Dashboard }) {
  const now = useNow(15_000);
  const r = data.revenue;
  const waiting = longWaiting(data.active_orders, now, data.wait);
  const debtIn = data.debt_collected.cash + data.debt_collected.transfer;

  return (
    <div className="flex flex-col gap-4 md:gap-5" data-testid="dashboard">
      {/* Doanh thu hôm nay */}
      <section className="flex flex-col gap-3.5 rounded-[20px] bg-brand p-[18px] text-white">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-medium leading-[18px]">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/[0.18]">
              <Wallet className="h-[18px] w-[18px]" />
            </span>
            Doanh thu hôm nay
          </span>
          <Chip className="bg-white text-[#c2380a]" testId="dash-orders">
            {r.orders} đơn đã thu
          </Chip>
        </div>
        <p className="flex items-end gap-1">
          <b className="num text-[38px] font-bold leading-[44px] tracking-normal" data-testid="dash-revenue">
            {formatVnd(r.total)}
          </b>
          <span className="text-xl font-semibold leading-[34px] text-white/80">đ</span>
        </p>
        <p className="num grid grid-cols-3 gap-2" data-testid="dash-revenue-split">
          {/* Dấu phân cách chỉ cho trình đọc màn hình: chữ đọc là "Tiền mặt … · CK … · Ghi nợ …". */}
          <Split icon={Banknote} label="Tiền mặt" value={formatVnd(r.cash)} />
          <span className="sr-only"> · </span>
          <Split icon={Landmark} label="CK" value={formatVnd(r.transfer)} />
          <span className="sr-only"> · </span>
          <Split icon={HandCoins} label="Ghi nợ" value={formatVnd(r.debt)} />
        </p>
      </section>

      {/* Điện thoại: một cột theo thứ tự điểm bán → số ca/đơn → đơn chờ → ca. Tablet: hai cột. */}
      <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start md:gap-5">
        <div className="contents md:flex md:flex-col md:gap-4">
          <section className={`${card} order-1 gap-3.5 p-4 md:order-none`}>
            <CardHead title="Theo điểm bán" link={{ to: '/owner/reports', label: 'Báo cáo' }} />
            {data.by_point.map((p) => {
              const pct = r.total > 0 ? Math.round((p.total / r.total) * 100) : 0;
              return (
                <div key={p.point_id} className="flex flex-col gap-2" data-testid={`dash-point-${p.point_id}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f8f8f8] text-[#6d6d6d]">
                        <Store className="h-[18px] w-[18px]" />
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-semibold leading-[19px]">{p.point_name}</span>
                        <span className="num text-xs leading-[15px] text-[#888]">
                          <span data-testid={`dash-point-${p.point_id}-transfer`}>CK {formatVnd(p.transfer)}</span> · {pct}%
                        </span>
                      </span>
                    </span>
                    <b className="num text-[15px] leading-[19px]" data-testid={`dash-point-${p.point_id}-total`}>
                      {formatVnd(p.total)}
                    </b>
                  </div>
                  <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-[#efefef]">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </span>
                </div>
              );
            })}
            {debtIn > 0 && (
              <p className="num rounded-xl bg-[#f8f8f8] px-3 py-2.5 text-[13px] font-medium leading-4 text-[#6d6d6d]" data-testid="dash-debt-collected">
                Thu nợ: TM {formatVnd(data.debt_collected.cash)} · CK {formatVnd(data.debt_collected.transfer)}
              </p>
            )}
            {data.deleted.count > 0 && (
              <Link
                to="/owner/orders?status=deleted"
                className={`flex items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold leading-4 ${
                  data.deleted.served ? 'bg-[#fdecec] text-[#b91c1c]' : 'bg-[#f8f8f8] text-[#6d6d6d]'
                }`}
                data-testid="dash-deleted"
              >
                <span className="flex items-center gap-2">
                  <CircleAlert aria-hidden className="h-4 w-4 shrink-0" />
                  Đã xóa {data.deleted.count} đơn · {data.deleted.served} đã ra món
                </span>
                <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
              </Link>
            )}
          </section>

          <section className={`${card} order-4 gap-2.5 p-4 md:order-none`} data-testid="dash-shifts">
            <CardHead title="Ca đang mở" link={{ to: '/owner/shifts', label: 'Tất cả ca' }} />
            {data.open_shifts.length === 0 && <p className="text-[13px] text-[#888]">Không có ca nào đang mở.</p>}
            {data.open_shifts.map((s) => (
              <Link
                key={s.shift_id}
                to={`/owner/shifts/${s.shift_id}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-[#f8f8f8] px-3 py-2.5 hover:bg-[#f0f0f0]"
                data-testid={`dash-shift-${s.shift_id}`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#ffeee7] text-[15px] font-bold text-[#c2380a]">
                    {s.staff_name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold leading-[19px]">{s.staff_name}</span>
                    <span className="truncate text-xs leading-[15px] text-[#888]">{s.tablet_name}</span>
                  </span>
                </span>
                <Chip className="num bg-[#e8f7ee] text-[#15803d]">
                  <Clock aria-hidden className="h-3.5 w-3.5" />
                  từ {hhmm(s.opened_at)}
                </Chip>
              </Link>
            ))}
          </section>
        </div>

        <div className="contents md:flex md:flex-col md:gap-4">
          <div className="order-2 grid grid-cols-2 gap-3 md:order-none">
            <Stat
              to="/owner/shifts"
              icon={Users}
              tone="bg-[#e8f7ee] text-[#15803d]"
              label="Ca đang mở"
              value={<span data-testid="dash-shift-count">{data.open_shifts.length}</span>}
              unit="ca"
            />
            <Stat
              to="/owner/orders"
              icon={ChefHat}
              tone="bg-[#fef5e1] text-[#a16207]"
              label="Đơn đang chờ"
              value={<span data-testid="dash-active-count">{data.active_orders.length}</span>}
              unit={waiting.length > 0 ? `· ${waiting.length} chờ lâu` : undefined}
            />
          </div>

          <section className={`${card} order-3 gap-2.5 p-4 md:order-none`} data-testid="dash-waiting">
            <CardHead title="Đơn đang chờ">
              {waiting.length > 0 && (
                <Chip className="bg-[#fdecec] text-[#b91c1c]">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#dc2626]" />
                  {waiting.length} chờ lâu
                </Chip>
              )}
            </CardHead>
            {waiting.map((o) => {
              const red = o.color === 'red';
              return (
                <Link
                  key={o.id}
                  to={`/owner/orders/${o.id}`}
                  data-testid={`dash-wait-${o.id}`}
                  data-color={o.color}
                  className={`flex items-center justify-between gap-2.5 rounded-xl p-3 ${red ? 'bg-[#fdecec] text-[#b91c1c]' : 'bg-[#fef5e1] text-[#a16207]'}`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className={`h-[34px] w-1 shrink-0 rounded-sm ${red ? 'bg-[#dc2626]' : 'bg-[#f59e0b]'}`} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <b className="text-sm leading-[18px]">
                        Đơn #{o.code}
                      </b>
                      <span className="truncate text-xs leading-[15px] opacity-85">
                        {[o.label, o.point_name, o.tablet_name].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </span>
                  <Chip className="num bg-white">
                    <Timer aria-hidden className="h-3.5 w-3.5" />
                    {Math.floor(minutesBetween(o.created_at, now))} phút
                  </Chip>
                </Link>
              );
            })}
            {waiting.length === 0 && (
              <p className="text-[13px] text-[#888]">{data.active_orders.length > 0 ? 'Không có đơn chờ ra món lâu.' : 'Không có đơn đang chờ.'}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Split({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-1 rounded-xl bg-white/[0.16] p-2.5">
      <span className="flex items-center gap-1 text-[11px] font-medium leading-[14px] text-white/85">
        <Icon aria-hidden className="h-[13px] w-[13px] shrink-0" />
        <span className="whitespace-nowrap">{label}</span>
      </span>{' '}
      <span className="text-[15px] font-bold leading-[19px]">{value}</span>
    </span>
  );
}

function Stat({
  to,
  icon: Icon,
  tone,
  label,
  value,
  unit,
}: {
  to: string;
  icon: LucideIcon;
  tone: string;
  label: string;
  value: ReactNode;
  unit?: string;
}) {
  return (
    <Link to={to} className={`${card} gap-2.5 p-3.5 hover:border-line-strong`}>
      <span className="flex items-center justify-between">
        <span aria-hidden className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${tone}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <ArrowUpRight aria-hidden className="h-4 w-4 text-[#888]" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-xs leading-[15px] text-[#888]">{label}</span>
        <span className="flex items-end gap-1.5">
          <b className="num text-2xl leading-7">{value}</b>
          {unit && <span className="text-xs leading-[22px] text-[#888]">{unit}</span>}
        </span>
      </span>
    </Link>
  );
}
