import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, CircleCheck, Landmark, ReceiptText, Wallet, type LucideIcon } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { formatSigned, formatVnd } from '@/domain/money';
import { methodShares, shiftDate, shortDate } from '@/domain/report';
import { businessDate, hhmm } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { Chip, OwnerLayout } from '../OwnerLayout';
import { PageHead, Section, TONE, card } from '../ui';
import { loadReport, type Report } from './api';

type Preset = 'today' | '7d' | 'month' | 'custom';
const PRESETS: Array<[Preset, string]> = [
  ['today', 'Hôm nay'],
  ['7d', '7 ngày'],
  ['month', 'Tháng này'],
  ['custom', 'Tùy chọn'],
];

function presetRange(p: Exclude<Preset, 'custom'>, today: string): [string, string] {
  if (p === 'today') return [today, today];
  if (p === '7d') return [shiftDate(today, -6), today];
  return [`${today.slice(0, 8)}01`, today];
}

/** `/owner/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` (mặc định: hôm nay). Figma R25 / T24. */
export function ReportPage() {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const [params, setParams] = useSearchParams();
  const today = businessDate(new Date());
  const from = params.get('from') || today;
  const to = params.get('to') || from;
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matched = (['today', '7d', 'month'] as const).find((p) => {
    const [f, t] = presetRange(p, today);
    return f === from && t === to;
  });
  const [custom, setCustom] = useState(!matched);
  const preset: Preset = custom || !matched ? 'custom' : matched;

  useEffect(() => {
    let alive = true;
    setReport(null);
    setError(null);
    loadReport(client, from, to)
      .then((r) => alive && setReport(r))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client, from, to]);

  const setRange = (f: string, t: string) => setParams({ from: f, to: t < f ? f : t }, { replace: true });
  function pick(p: Preset) {
    setCustom(p === 'custom');
    if (p !== 'custom') setRange(...presetRange(p, today));
  }
  const rangeLabel = from === to ? shortDate(from) : `${shortDate(from)}–${shortDate(to)}`;
  const subtitle = 'Theo ngày / điểm / ca / nhân viên';

  return (
    <OwnerLayout title={isTablet ? 'Báo cáo doanh thu' : 'Báo cáo'} subtitle={isTablet ? subtitle : undefined} back="/owner" wide testId="report-page">
      <div className="flex flex-col gap-3.5 md:gap-5">
        {!isTablet && <PageHead title="Báo cáo doanh thu" subtitle={subtitle} />}
        <div role="group" aria-label="Khoảng ngày" className="grid h-10 grid-cols-4 gap-1 rounded-xl bg-[#efefef] p-1">
          {PRESETS.map(([k, label]) => {
            const on = preset === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => pick(k)}
                className={`rounded-[9px] text-[13px] leading-4 transition-colors duration-fast ${
                  on ? 'bg-white font-semibold text-[#111] shadow-[0_4px_16px_rgb(0_0_0/0.06)]' : 'font-medium text-[#6d6d6d] hover:text-[#111]'
                }`}
                data-testid={`report-${k}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <DateBox label="Từ ngày" value={from} onChange={(v) => setRange(v, to)} testId="report-from" />
            <DateBox label="Đến ngày" value={to} onChange={(v) => setRange(from, v)} testId="report-to" />
          </div>
        )}
        <ErrorText testId="report-error">{error}</ErrorText>
        {!report && !error && <Splash />}
        {report && <ReportBody r={report} rangeLabel={rangeLabel} isToday={from === today && to === today} />}
      </div>
    </OwnerLayout>
  );
}

function DateBox({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <label className="flex h-[38px] items-center gap-2 rounded-xl border border-line bg-white px-3 focus-within:border-brand">
      <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-[#6d6d6d]" />
      <input
        type="date"
        aria-label={label}
        className="num min-w-0 flex-1 bg-transparent text-[13px] font-medium leading-4 outline-none"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        data-testid={testId}
      />
    </label>
  );
}

const DOT = { cash: 'bg-[#16a34a]', transfer: 'bg-[#2563eb]', debt: 'bg-[#f59e0b]' } as const;
const SHORT = { cash: 'TM', transfer: 'CK', debt: 'Nợ' } as const;

function ReportBody({ r, rangeLabel, isToday }: { r: Report; rangeLabel: string; isToday: boolean }) {
  const shares = methodShares(r.revenue);
  const avg = r.revenue.orders > 0 ? Math.round(r.revenue.total / r.revenue.orders) : 0;

  // Gộp theo điểm cho cả khoảng ngày.
  const points = new Map<string, { name: string; orders: number; cash: number; transfer: number; debt: number; total: number }>();
  for (const x of r.by_day_point) {
    const p = points.get(x.point_id) ?? { name: x.point_name, orders: 0, cash: 0, transfer: 0, debt: 0, total: 0 };
    p.orders += x.orders;
    p.cash += x.cash;
    p.transfer += x.transfer;
    p.debt += x.debt;
    p.total += x.total;
    points.set(x.point_id, p);
  }
  const maxStaff = Math.max(1, ...r.by_staff.map((s) => s.total));

  const payment = (
    <Section
      title="Hình thức thanh toán"
      right={
        <b className="num text-sm leading-5" data-testid="report-revenue-split" title={`TM ${formatVnd(r.revenue.cash)} · CK ${formatVnd(r.revenue.transfer)} · Nợ ${formatVnd(r.revenue.debt)}`}>
          {formatVnd(r.revenue.total)}
        </b>
      }
      className="!gap-3"
    >
      <span className="flex h-3 gap-0.5 overflow-hidden rounded-md bg-[#efefef]" aria-hidden>
        {(['cash', 'transfer', 'debt'] as const).map((k) => r.revenue[k] > 0 && <span key={k} className={DOT[k]} style={{ width: `${(r.revenue[k] / Math.max(1, r.revenue.total)) * 100}%` }} />)}
      </span>
      <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs leading-[15px]">
        <span className="sr-only" data-testid="report-revenue-shares">
          TM {shares.cash}% · CK {shares.transfer}% · Nợ {shares.debt}%
        </span>
        {(['cash', 'transfer', 'debt'] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5" aria-hidden>
            <span className={`h-2 w-2 rounded-full ${DOT[k]}`} />
            <span className="text-[#6d6d6d]">{SHORT[k]}</span>
            <b className="num font-semibold">
              {formatVnd(r.revenue[k])}
              {r.revenue[k] > 0 && ` · ${shares[k]}%`}
            </b>
          </span>
        ))}
      </p>
    </Section>
  );

  const byPoint = (
    <section className={`${card} overflow-hidden`} data-testid="report-points">
      <div className="flex items-center justify-between gap-2 p-3.5">
        <h2 className="text-base font-bold leading-5 tracking-normal">Theo điểm bán</h2>
        <Chip className={`num ${TONE.gray}`}>
          <CalendarDays aria-hidden className="h-3.5 w-3.5" />
          {rangeLabel}
        </Chip>
      </div>
      <div className={`${row} bg-[#f8f8f8] py-2.5 text-xs font-medium leading-[15px] text-[#6d6d6d]`}>
        <span>Điểm</span>
        <span className="text-right">Đơn</span>
        <span className="text-right">TM</span>
        <span className="text-right">Nợ</span>
        <span className="text-right">Tổng</span>
      </div>
      {points.size === 0 && <p className="px-3.5 py-3 text-[13px] text-[#888]">Chưa có doanh thu.</p>}
      {[...points].map(([id, p]) => (
        <div key={id} className={`${row} num border-b border-line py-3 text-[13px] leading-4 last:border-b-0`} data-testid={`report-point-${id}`} title={`CK ${formatVnd(p.transfer)}`}>
          <span className="truncate">{p.name}</span>
          <span className="text-right">{p.orders}</span>
          <span className="text-right">{formatVnd(p.cash)}</span>
          <span className="text-right">{formatVnd(p.debt)}</span>
          <b className="text-right" data-testid={`report-point-${id}-total`}>
            {formatVnd(p.total)}
          </b>
        </div>
      ))}
    </section>
  );

  const byStaff = (
    <Section title="Theo nhân viên" right={<span className="text-xs leading-5 text-[#888]">theo ca thu tiền</span>} testId="report-staff">
      {[...r.by_staff].sort((a, b) => b.total - a.total).map((s) => {
        const sh = methodShares(s);
        const parts = [`${s.orders} đơn`, ...(['cash', 'transfer', 'debt'] as const).filter((k) => sh[k] > 0).map((k) => `${SHORT[k]} ${sh[k]}%`)];
        return (
          <div key={s.staff_id} className="flex flex-col gap-2" data-testid={`report-staff-${s.staff_id}`}>
            <div className="flex items-center justify-between gap-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f8f8f8] text-[15px] font-bold text-[#6d6d6d]">
                  {s.staff_name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="truncate text-sm font-semibold leading-[18px]">{s.staff_name}</span>
                  <span className="num truncate text-xs leading-[15px] text-[#888]" data-testid={`report-staff-${s.staff_id}-shares`} title={`TM ${formatVnd(s.cash)} · CK ${formatVnd(s.transfer)} · Nợ ${formatVnd(s.debt)}`}>
                    {parts.join(' · ')}
                    {s.debt_collected > 0 && ` · thu nợ ${formatVnd(s.debt_collected)}`}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {s.edits > 0 && (
                  <Link to={`/owner/log?type=order_update&staff=${s.staff_id}`} data-testid={`report-staff-${s.staff_id}-edits`}>
                    <Chip className={`${TONE.amber} !px-2 !py-0.5 !text-[11px] !leading-[14px]`}>Sửa {s.edits}</Chip>
                  </Link>
                )}
                {s.deletes > 0 && (
                  <Link to={`/owner/log?type=order_delete&staff=${s.staff_id}`} data-testid={`report-staff-${s.staff_id}-deletes`}>
                    <Chip className={`${TONE.red} !px-2 !py-0.5 !text-[11px] !leading-[14px]`}>Xóa {s.deletes}</Chip>
                  </Link>
                )}
                <b className="num text-sm leading-[18px]" data-testid={`report-staff-${s.staff_id}-total`}>
                  {formatVnd(s.total)}
                </b>
              </span>
            </div>
            <span aria-hidden className="h-1.5 overflow-hidden rounded-[3px] bg-[#efefef]">
              <span className="block h-full rounded-[3px] bg-brand" style={{ width: `${(s.total / maxStaff) * 100}%` }} />
            </span>
          </div>
        );
      })}
    </Section>
  );

  const bank = (
    <section className={`${card} gap-2.5 p-4`} data-testid="report-bank">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${TONE.blue}`}>
          <Landmark className="h-[17px] w-[17px]" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[15px] font-bold leading-[19px] tracking-normal">Đối chiếu chuyển khoản</h2>
          <span className="text-xs leading-[15px] text-[#888]">So từng dòng với app ngân hàng</span>
        </span>
      </div>
      {r.bank_check.length === 0 && (
        <p className="flex flex-col items-center gap-1.5 rounded-xl bg-[#f8f8f8] px-3 py-[18px] text-[13px] leading-4 text-[#888]">
          <CircleCheck aria-hidden className="h-[22px] w-[22px] text-[#6d6d6d]" />
          Không có chuyển khoản {isToday ? 'hôm nay' : 'trong khoảng này'}
        </p>
      )}
      {r.bank_check.map((d) => (
        <div key={d.date} className="flex flex-col gap-1.5 rounded-xl bg-[#f8f8f8] px-3 py-2.5 text-[13px] leading-4" data-testid={`report-bank-day-${d.date}`}>
          <p className="flex justify-between font-semibold">
            <span>Ngày {shortDate(d.date)}</span>
            <span className="num" data-testid={`report-bank-${d.date}-total`}>
              {formatVnd(d.total)}
            </span>
          </p>
          {d.points.map((p) => (
            <p key={p.point_id} className="flex justify-between text-[#6d6d6d]">
              <span>
                {p.point_name} · {p.orders} đơn
              </span>
              <span className="num font-medium text-[#111]" data-testid={`report-bank-${d.date}-${p.point_id}`}>
                {formatVnd(p.amount)}
              </span>
            </p>
          ))}
          {d.debt_payments.count > 0 && (
            <p className="flex justify-between text-[#6d6d6d]">
              <span>Thu nợ CK · {d.debt_payments.count} lần</span>
              <span className="num font-medium text-[#111]" data-testid={`report-bank-${d.date}-debt`}>
                {formatVnd(d.debt_payments.amount)}
              </span>
            </p>
          )}
        </div>
      ))}
    </section>
  );

  /* Không có trong Figma R25 nhưng giữ lại (đối soát từng ca, món bán chạy). */
  const byShift = r.by_shift.length > 0 && (
    <Section title="Theo ca" testId="report-shifts">
      {r.by_shift.map((s) => (
        <Link key={s.shift_id} to={`/owner/shifts/${s.shift_id}`} className="flex items-center justify-between gap-2 rounded-xl bg-[#f8f8f8] px-3 py-2.5 hover:bg-[#f0f0f0]" data-testid={`report-shift-${s.shift_id}`}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-semibold leading-[18px]">
              {s.status === 'open' && <span aria-label="Đang mở" className="h-1.5 w-1.5 rounded-full bg-success" />}
              {s.staff_name} – {s.tablet_name}
            </span>
            <span className="num flex flex-wrap items-center gap-x-1.5 text-xs leading-[15px] text-[#888]">
              {shortDate(businessDate(s.opened_at))} {hhmm(s.opened_at)}–{s.closed_at ? hhmm(s.closed_at) : 'đang mở'}
              {s.status === 'closed' && (
                <span className={s.reconcile.cash.diff ? 'font-semibold text-[#b91c1c]' : ''} data-testid={`report-shift-${s.shift_id}-cash-diff`}>
                  Tiền mặt {formatSigned(s.reconcile.cash.diff ?? 0)}
                </span>
              )}
              {s.recalculated_at && (
                <Chip className={`${TONE.amber} !px-2 !py-0 !text-[11px]`} testId={`report-shift-${s.shift_id}-adjusted`}>
                  đã điều chỉnh
                </Chip>
              )}
            </span>
          </span>
          <b className="num shrink-0 text-sm">{formatVnd(s.reconcile.revenue.total)}</b>
        </Link>
      ))}
    </Section>
  );
  const top = r.top_products.length > 0 && (
    <Section title="Món bán chạy" testId="report-top">
      {r.top_products.slice(0, 10).map((p, i) => (
        <p key={p.product_id} className="flex items-center justify-between gap-2 text-[13px] leading-4" data-testid="report-top-row">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#f8f8f8] text-xs font-bold text-[#6d6d6d]">{i + 1}</span>
            <span className="truncate font-medium">
              {p.name} × {p.qty}
            </span>
          </span>
          <span className="num text-[#6d6d6d]">{formatVnd(p.revenue)}</span>
        </p>
      ))}
    </Section>
  );

  return (
    <div className="flex flex-col gap-3.5 md:gap-5" data-testid="report-body">
      <div className="grid grid-cols-2 items-center gap-2.5">
        <Kpi icon={Wallet} tone="bg-[#ffeee7] text-[#c2380a]" label="Doanh thu" value={<span data-testid="report-revenue">{formatVnd(r.revenue.total)}</span>} />
        <Kpi
          icon={ReceiptText}
          tone={TONE.blue}
          label="Đơn đã thu"
          value={<span data-testid="report-orders">{r.revenue.orders}</span>}
          foot={r.revenue.orders > 0 ? `TB ${formatVnd(avg)} / đơn` : undefined}
        />
      </div>
      {/* Điện thoại: một cột theo thứ tự hình thức → điểm → nhân viên → CK. Tablet: hai cột. */}
      <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:items-start md:gap-5">
        <div className="contents md:flex md:flex-col md:gap-4">
          <div className="order-1 md:order-none">{payment}</div>
          <div className="order-2 md:order-none">{byPoint}</div>
          <div className="order-4 md:order-none">{bank}</div>
          {byShift && <div className="order-5 md:order-none">{byShift}</div>}
        </div>
        <div className="contents md:flex md:flex-col md:gap-4">
          <div className="order-3 md:order-none">{byStaff}</div>
          {top && <div className="order-6 md:order-none">{top}</div>}
        </div>
      </div>
    </div>
  );
}

const row = 'grid grid-cols-[minmax(0,1fr)_28px_64px_56px_64px] items-center gap-2 px-3.5';

function Kpi({ icon: Icon, tone, label, value, foot }: { icon: LucideIcon; tone: string; label: string; value: ReactNode; foot?: string }) {
  return (
    <div className={`${card} gap-2.5 p-3.5`}>
      <span aria-hidden className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] ${tone}`}>
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-xs leading-[15px] text-[#888]">{label}</span>
        <b className="num text-xl leading-[26px]">{value}</b>
        {foot && <span className="num text-[11px] leading-[14px] text-[#888]">{foot}</span>}
      </span>
    </div>
  );
}
