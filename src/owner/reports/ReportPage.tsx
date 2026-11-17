import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { formatSigned, formatVnd } from '@/domain/money';
import { methodShares, shiftDate, shortDate } from '@/domain/report';
import { businessDate, hhmm } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { loadReport, type Report } from './api';

const input = 'input px-3';

/** `/owner/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` (mặc định: hôm nay). */
export function ReportPage() {
  const { client } = useOwner();
  const [params, setParams] = useSearchParams();
  const today = businessDate(new Date());
  const from = params.get('from') || today;
  const to = params.get('to') || from;
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <OwnerLayout title="Báo cáo" back="/owner" testId="report-page">
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className={input} value={from} onChange={(e) => e.target.value && setRange(e.target.value, to)} data-testid="report-from" aria-label="Từ ngày" />
        <input type="date" className={input} value={to} onChange={(e) => e.target.value && setRange(from, e.target.value)} data-testid="report-to" aria-label="Đến ngày" />
        <button type="button" className="btn btn-secondary" onClick={() => setRange(today, today)} data-testid="report-today">
          Hôm nay
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setRange(shiftDate(today, -6), today)} data-testid="report-7d">
          7 ngày
        </button>
      </div>
      <ErrorText testId="report-error">{error}</ErrorText>
      {!report && !error && <Splash />}
      {report && <ReportBody r={report} />}
    </OwnerLayout>
  );
}

function ReportBody({ r }: { r: Report }) {
  const shares = methodShares(r.revenue);
  return (
    <div className="flex flex-col gap-4" data-testid="report-body">
      <Card title="Doanh thu">
        <Line label="Tổng" value={formatVnd(r.revenue.total)} testId="report-revenue" strong />
        <Line
          label="TM · CK · Nợ"
          value={`${formatVnd(r.revenue.cash)} · ${formatVnd(r.revenue.transfer)} · ${formatVnd(r.revenue.debt)}`}
          testId="report-revenue-split"
        />
        <Line label="Tỷ lệ" value={`TM ${shares.cash}% · CK ${shares.transfer}% · Nợ ${shares.debt}%`} testId="report-revenue-shares" />
        <Line label="Số đơn đã thu" value={String(r.revenue.orders)} testId="report-orders" />
      </Card>

      <Card title="Đối chiếu chuyển khoản" testId="report-bank">
        <p className="text-sm text-ink-subtle">So từng dòng với app ngân hàng. Nhân viên ghi “chuyển khoản” mà thực ra nhận tiền mặt ⇒ số ở đây cao hơn tiền vào tài khoản.</p>
        {r.bank_check.length === 0 && <p className="text-ink-subtle">Không có chuyển khoản.</p>}
        {r.bank_check.map((d) => (
          <div key={d.date} className="flex flex-col border-t border-line py-2" data-testid={`report-bank-day-${d.date}`}>
            <p className="flex justify-between font-semibold">
              <span>Ngày {shortDate(d.date)}</span>
              <span data-testid={`report-bank-${d.date}-total`}>{formatVnd(d.total)}</span>
            </p>
            {d.points.map((p) => (
              <p key={p.point_id} className="flex justify-between pl-3 text-ink">
                <span>
                  {p.point_name} <span className="text-sm text-ink-subtle">({p.orders} đơn)</span>
                </span>
                <span data-testid={`report-bank-${d.date}-${p.point_id}`}>{formatVnd(p.amount)}</span>
              </p>
            ))}
            {d.debt_payments.count > 0 && (
              <p className="flex justify-between pl-3 text-ink">
                <span>
                  Thu nợ CK <span className="text-sm text-ink-subtle">({d.debt_payments.count} lần)</span>
                </span>
                <span data-testid={`report-bank-${d.date}-debt`}>{formatVnd(d.debt_payments.amount)}</span>
              </p>
            )}
          </div>
        ))}
      </Card>

      <Card title="Theo ngày / điểm">
        {r.by_day_point.length === 0 && <p className="text-ink-subtle">Chưa có doanh thu.</p>}
        {r.by_day_point.map((x) => (
          <div key={`${x.date}-${x.point_id}`} className="flex flex-col border-t border-line py-2" data-testid={`report-day-point-${x.date}-${x.point_id}`}>
            <p className="flex justify-between">
              <span>
                {shortDate(x.date)} · {x.point_name}
              </span>
              <b data-testid={`report-day-point-${x.date}-${x.point_id}-total`}>{formatVnd(x.total)}</b>
            </p>
            <p className="text-right text-sm text-ink-muted">
              TM {formatVnd(x.cash)} · CK {formatVnd(x.transfer)} · Nợ {formatVnd(x.debt)} · {x.orders} đơn
            </p>
          </div>
        ))}
      </Card>

      <Card title="Theo nhân viên" testId="report-staff">
        <p className="text-sm text-ink-subtle">Doanh thu tính theo ca thu tiền. Sửa / xóa: số lần nhân viên sửa hoặc xóa đơn đang mở.</p>
        {r.by_staff.map((s) => {
          const sh = methodShares(s);
          return (
            <div key={s.staff_id} className="flex flex-col border-t border-line py-2" data-testid={`report-staff-${s.staff_id}`}>
              <p className="flex justify-between">
                <span className="font-medium">{s.staff_name}</span>
                <b data-testid={`report-staff-${s.staff_id}-total`}>{formatVnd(s.total)}</b>
              </p>
              <p className="text-sm text-ink-muted" data-testid={`report-staff-${s.staff_id}-split`}>
                TM {formatVnd(s.cash)} · CK {formatVnd(s.transfer)} · Nợ {formatVnd(s.debt)} · {s.orders} đơn
              </p>
              <p className="text-sm text-ink-muted" data-testid={`report-staff-${s.staff_id}-shares`}>
                TM {sh.cash}% · CK {sh.transfer}% · Nợ {sh.debt}%
              </p>
              {s.debt_collected > 0 && <p className="text-sm text-ink-muted">Thu nợ {formatVnd(s.debt_collected)}</p>}
              <p className="flex gap-4 text-sm">
                <Link
                  to={`/owner/log?type=order_update&staff=${s.staff_id}`}
                  className={`underline ${s.edits ? 'text-danger-strong' : 'text-ink-subtle'}`}
                  data-testid={`report-staff-${s.staff_id}-edits`}
                >
                  Sửa {s.edits}
                </Link>
                <Link
                  to={`/owner/log?type=order_delete&staff=${s.staff_id}`}
                  className={`underline ${s.deletes ? 'text-danger-strong' : 'text-ink-subtle'}`}
                  data-testid={`report-staff-${s.staff_id}-deletes`}
                >
                  Xóa {s.deletes}
                </Link>
              </p>
            </div>
          );
        })}
      </Card>

      <Card title="Theo ca">
        {r.by_shift.length === 0 && <p className="text-ink-subtle">Không có ca.</p>}
        {r.by_shift.map((s) => (
          <Link key={s.shift_id} to={`/owner/shifts/${s.shift_id}`} className="flex flex-col border-t border-line py-2" data-testid={`report-shift-${s.shift_id}`}>
            <span className="flex justify-between">
              <span>
                {s.status === 'open' && <span aria-label="Đang mở" className="dot mr-2 bg-success" />}
                {s.staff_name} – {s.tablet_name} · {shortDate(businessDate(s.opened_at))} {hhmm(s.opened_at)}–{s.closed_at ? hhmm(s.closed_at) : 'đang mở'}
              </span>
              <b>{formatVnd(s.reconcile.revenue.total)}</b>
            </span>
            <span className="text-sm text-ink-muted">
              {s.status === 'closed' && (
                <span className={s.reconcile.cash.diff ? 'text-danger-strong' : ''} data-testid={`report-shift-${s.shift_id}-cash-diff`}>
                  Tiền mặt {formatSigned(s.reconcile.cash.diff ?? 0)}
                </span>
              )}
              {s.recalculated_at && (
                <span className="ml-2 rounded bg-warning-soft px-1.5 text-warning-strong" data-testid={`report-shift-${s.shift_id}-adjusted`}>
                  đã điều chỉnh
                </span>
              )}
            </span>
          </Link>
        ))}
      </Card>

      <Card title="Món bán chạy">
        {r.top_products.length === 0 && <p className="text-ink-subtle">Chưa có.</p>}
        {r.top_products.slice(0, 10).map((p, i) => (
          <p key={p.product_id} className="flex justify-between" data-testid="report-top-row">
            <span>
              {i + 1}. {p.name} × {p.qty}
            </span>
            <span className="text-ink-muted">{formatVnd(p.revenue)}</span>
          </p>
        ))}
      </Card>
    </div>
  );
}

function Card({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 card p-4" data-testid={testId}>
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Line({ label, value, testId, strong }: { label: string; value: string; testId: string; strong?: boolean }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className={`text-right ${strong ? 'text-xl font-bold' : ''}`} data-testid={testId}>
        {value}
      </span>
    </p>
  );
}
