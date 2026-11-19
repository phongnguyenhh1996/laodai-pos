import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Cake, ChevronLeft, ChevronRight } from 'lucide-react';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import {
  PAYROLL_KIND_LABELS, PAYROLL_KIND_SHORT, computePayslip, daysUntilBirthday, formatDate, formatMinutes, formatPhone, isMonth, monthGrid,
  monthLabel, monthOf, parseDaysInput, shiftMonth, workDays, type PayrollEntry, type PayrollKind, type Payslip,
} from '@/domain/payroll';
import { businessDate, hhmm, minutesBetween } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { addPayrollEntry, loadPayrollMonth, voidPayrollEntry, type PayrollMonth } from './api';

/** `/owner/payroll/*?m=YYYY-MM`: lương tháng của từng nhân viên. */
export function PayrollRoutes() {
  return (
    <Routes>
      <Route index element={<PayrollList />} />
      <Route path=":staffId" element={<StaffPayroll />} />
    </Routes>
  );
}

const PAYROLL = '/owner/payroll';

function useMonth(): [string, (ym: string) => void] {
  const [params, setParams] = useSearchParams();
  const m = params.get('m');
  const ym = isMonth(m) ? m : monthOf(new Date());
  return [ym, (next) => setParams({ m: next }, { replace: true })];
}

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [load]);
  useEffect(() => {
    setData(undefined);
    void reload();
  }, [reload]);
  return { data, error, reload };
}

function MonthPicker({ ym, onChange }: { ym: string; onChange: (ym: string) => void }) {
  const current = monthOf(new Date());
  return (
    <div className="card flex items-center justify-between gap-2 p-2" data-testid="payroll-month">
      <button type="button" className="btn btn-secondary px-0" aria-label="Tháng trước" onClick={() => onChange(shiftMonth(ym, -1))} data-testid="payroll-prev">
        <ChevronLeft aria-hidden className="h-6 w-6" />
      </button>
      <span className="text-center">
        <b className="block text-lg" data-testid="payroll-month-label">{monthLabel(ym)}</b>
        {ym === current && <span className="text-sm text-ink-subtle">Tháng này · còn đang tính</span>}
      </span>
      <button
        type="button"
        className="btn btn-secondary px-0"
        aria-label="Tháng sau"
        disabled={ym >= current}
        onClick={() => onChange(shiftMonth(ym, 1))}
        data-testid="payroll-next"
      >
        <ChevronRight aria-hidden className="h-6 w-6" />
      </button>
    </div>
  );
}

const rateLabel = (p: Pick<Payslip, 'rate'>) => (p.rate ? `${formatVnd(p.rate)} / ngày` : 'Chưa đặt lương ngày');

// ---------------------------------------------------------------- danh sách

function PayrollList() {
  const { client } = useOwner();
  const [ym, setYm] = useMonth();
  const { data, error } = useLoad(useCallback(() => loadPayrollMonth(client, ym), [client, ym]));

  const rows = data
    ? data.staff
        .map((s) => ({ s, p: computePayslip(data.details.find((d) => d.id === s.id) ?? null, data.shifts.filter((x) => x.staff_id === s.id), data.entries.filter((e) => e.staff_id === s.id), ym) }))
        // Nhân viên nghỉ việc chỉ hiện ở tháng họ còn có ca / sổ lương.
        .filter(({ s, p }) => s.active || p.shifts > 0 || p.total !== 0 || p.advance + p.payment > 0)
    : [];
  const sum = (k: 'total' | 'remaining') => rows.reduce((t, r) => t + r.p[k], 0);
  const paid = rows.reduce((t, r) => t + r.p.advance + r.p.payment, 0);

  return (
    <OwnerLayout title="Lương" back="/owner" testId="payroll-list">
      <MonthPicker ym={ym} onChange={setYm} />
      <ErrorText testId="payroll-error">{error}</ErrorText>
      {!data && !error && <Splash />}
      {data && (
        <>
          <section className="card grid grid-cols-3 gap-2 p-4 text-center" data-testid="payroll-totals">
            <Stat label="Tổng lương" value={formatVnd(sum('total'))} testId="payroll-total" />
            <Stat label="Đã ứng / trả" value={formatVnd(paid)} testId="payroll-paid" />
            <Stat label="Còn phải trả" value={formatVnd(sum('remaining'))} testId="payroll-remaining" strong />
          </section>
          <Birthdays data={data} ym={ym} />
          <nav className="card flex flex-col divide-y divide-line overflow-hidden">
            {rows.length === 0 && <p className="p-4 text-ink-subtle">Chưa có nhân viên.</p>}
            {rows.map(({ s, p }) => (
              <Link
                key={s.id}
                to={`${PAYROLL}/${s.id}?m=${ym}`}
                className="flex min-h-tap items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-surface-muted active:bg-surface-sunken"
                data-testid={`payroll-row-${s.id}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block text-lg font-medium ${s.active ? '' : 'text-ink-subtle'}`}>
                    {s.name}
                    {!s.active && ' (nghỉ)'}
                  </span>
                  <span className={`block truncate text-sm ${p.rate ? 'text-ink-subtle' : 'text-warning-strong'}`}>
                    {p.days} ngày · {rateLabel(p)}
                  </span>
                </span>
                <span className="num shrink-0 text-right">
                  <b className="block text-lg" data-testid={`payroll-row-${s.id}-total`}>{formatVnd(p.total)}</b>
                  <span className={`block text-sm ${p.remaining > 0 ? 'text-warning-strong' : 'text-success-strong'}`} data-testid={`payroll-row-${s.id}-remaining`}>
                    {p.remaining > 0 ? `còn ${formatVnd(p.remaining)}` : p.remaining < 0 ? `trả dư ${formatVnd(-p.remaining)}` : p.total ? 'đã trả đủ' : '—'}
                  </span>
                </span>
                <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-ink-subtle" />
              </Link>
            ))}
          </nav>
          <p className="text-sm text-ink-subtle">
            Lương tính theo ngày: ngày công là số ngày nhân viên có mở ca trên máy bán hàng (mở nhiều ca trong ngày vẫn tính 1 ngày), chủ cộng /
            trừ ngày công trong từng nhân viên. Lương một ngày sửa ở{' '}
            <Link to="/owner/settings/staff" className="underline">
              Cài đặt › Nhân viên
            </Link>
            .
          </p>
        </>
      )}
    </OwnerLayout>
  );
}

function Stat({ label, value, testId, strong }: { label: string; value: string; testId: string; strong?: boolean }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
      <b className={`num ${strong ? 'text-xl' : 'text-lg font-semibold'}`} data-testid={testId}>
        {value}
      </b>
    </span>
  );
}

/** Sinh nhật trong tháng đang xem của nhân viên đang làm. */
function Birthdays({ data, ym }: { data: PayrollMonth; ym: string }) {
  const today = businessDate(new Date());
  const list = data.staff
    .filter((s) => s.active)
    .map((s) => ({ s, b: data.details.find((d) => d.id === s.id)?.birthday ?? null }))
    .filter((x): x is { s: (typeof data.staff)[number]; b: string } => !!x.b && x.b.slice(5, 7) === ym.slice(5, 7))
    .sort((a, b) => a.b.slice(8).localeCompare(b.b.slice(8)));
  if (!list.length) return null;
  return (
    <p className="card flex flex-wrap items-center gap-x-3 gap-y-1 p-4" data-testid="payroll-birthdays">
      <Cake aria-hidden className="h-5 w-5 text-brand-strong" />
      <span className="font-semibold">Sinh nhật trong tháng:</span>
      {list.map(({ s, b }) => (
        <span key={s.id}>
          {s.name} ({formatDate(b).slice(0, 5)}
          {ym === today.slice(0, 7) && daysUntilBirthday(b, today) === 0 ? ' · hôm nay' : ''})
        </span>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------- một nhân viên

function StaffPayroll() {
  const { staffId = '' } = useParams();
  const { client } = useOwner();
  const [ym, setYm] = useMonth();
  const { data, error, reload } = useLoad(useCallback(() => loadPayrollMonth(client, ym, staffId), [client, ym, staffId]));
  const [actionError, setActionError] = useState<string | null>(null);

  const s = data?.staff.find((x) => x.id === staffId);
  const details = data?.details.find((d) => d.id === staffId) ?? null;
  const p = data && computePayslip(details, data.shifts, data.entries, ym);

  async function voidEntry(e: PayrollEntry) {
    if (!window.confirm(`Hủy dòng "${PAYROLL_KIND_LABELS[e.kind]} ${amountLabel(e)}"?`)) return;
    setActionError(null);
    try {
      await voidPayrollEntry(client, e.id);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <OwnerLayout title={s ? `Lương · ${s.name}` : 'Lương'} back={`${PAYROLL}?m=${ym}`} testId="payroll-staff">
      <MonthPicker ym={ym} onChange={setYm} />
      <ErrorText testId="payroll-error">{error ?? actionError}</ErrorText>
      {!data && !error && <Splash />}
      {data && !s && <p className="text-ink-subtle">Không có nhân viên này.</p>}
      {s && p && (
        <>
          <Card title="Bảng lương">
            <p className="text-sm text-ink-subtle" data-testid="payroll-rate">
              Theo ngày · {rateLabel(p)}
              {details?.phone ? (
                <>
                  {' · '}
                  <a href={`tel:${details.phone}`} className="underline" data-testid="payroll-phone">
                    {formatPhone(details.phone)}
                  </a>
                </>
              ) : null}
              {' · '}
              <Link to={`/owner/settings/staff/${s.id}`} className="underline" data-testid="payroll-edit-rate">
                Sửa
              </Link>
            </p>
            <WorkRows p={p} />
            <Row label={`Lương ngày công (${p.days} × ${formatVnd(p.rate)})`} value={formatVnd(p.base)} testId="payslip-base" />
            {p.bonus > 0 && <Row label="+ Thưởng / phụ cấp" value={formatVnd(p.bonus)} testId="payslip-bonus" />}
            {p.deduction > 0 && <Row label="− Trừ lương" value={formatVnd(p.deduction)} testId="payslip-deduction" />}
            <Row label="Lương tháng" value={formatVnd(p.total)} testId="payslip-total" strong divider />
            {p.advance > 0 && <Row label="− Đã ứng" value={formatVnd(p.advance)} testId="payslip-advance" />}
            {p.payment > 0 && <Row label="− Đã trả" value={formatVnd(p.payment)} testId="payslip-payment" />}
            <Row
              label={p.remaining < 0 ? 'Trả dư' : 'Còn phải trả'}
              value={formatVnd(Math.abs(p.remaining))}
              testId="payslip-remaining"
              strong
              divider
              tone={p.remaining > 0 ? 'text-warning-strong' : p.remaining < 0 ? 'text-danger-strong' : 'text-success-strong'}
            />
          </Card>
          <WorkCalendar data={data} ym={ym} p={p} birthday={details?.birthday ?? null} />
          <EntryForm staffId={s.id} ym={ym} remaining={p.remaining} onSaved={reload} />
          <Ledger entries={data.entries} onVoid={(e) => void voidEntry(e)} />
        </>
      )}
    </OwnerLayout>
  );
}

function WorkRows({ p }: { p: Payslip }) {
  const adj = p.days - p.shiftDays;
  return (
    <>
      <Row label="Số ca" value={`${p.shifts} ca`} testId="payslip-shifts" />
      <Row label="Ngày công" value={`${p.days} ngày${adj ? ` (có ca ${p.shiftDays}, chỉnh ${adj > 0 ? '+' : ''}${adj})` : ''}`} testId="payslip-days" />
    </>
  );
}

function amountLabel(e: Pick<PayrollEntry, 'kind' | 'amount'>): string {
  if (e.kind === 'days') return `${e.amount > 0 ? '+' : ''}${e.amount} ngày`;
  return formatVnd(e.amount);
}

const KINDS: PayrollKind[] = ['advance', 'payment', 'bonus', 'deduction', 'days'];

function EntryForm({
  staffId,
  ym,
  remaining,
  onSaved,
}: {
  staffId: string;
  ym: string;
  remaining: number;
  onSaved: () => Promise<void>;
}) {
  const { client } = useOwner();
  const [kind, setKind] = useState<PayrollKind>('advance');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeKind = kind;
  const parsed = activeKind === 'days' ? parseDaysInput(amount) : parseMoneyInput(amount);

  async function save(k: PayrollKind, value: number | null, n: string) {
    if (!value) {
      setError(k === 'days' ? 'Nhập số ngày, vd. 1 hoặc -1 để trừ' : 'Nhập số tiền lớn hơn 0');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addPayrollEntry(client, { staff_id: staffId, month: ym, kind: k, amount: value, note: n });
      setAmount('');
      setNote('');
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(activeKind, parsed, note);
  }

  const label = activeKind === 'days' ? 'Số ngày (vd. 1 nếu làm mà không mở ca, -1 để trừ)' : 'Số tiền';
  const verb = activeKind === 'days' ? 'ngày công' : PAYROLL_KIND_SHORT[activeKind].toLowerCase();
  const button = parsed ? `Ghi ${verb} ${amountLabel({ kind: activeKind, amount: parsed })}` : `Ghi ${verb}`;

  return (
    <Card title="Ghi sổ lương">
      {remaining > 0 && (
        <button
          type="button"
          className="btn btn-success"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Ghi đã trả ${formatVnd(remaining)} lương ${monthLabel(ym).toLowerCase()}?`)) void save('payment', remaining, 'Trả đủ lương tháng');
          }}
          data-testid="payroll-pay-all"
        >
          Trả đủ {formatVnd(remaining)}
        </button>
      )}
      <form className="flex flex-col gap-3" onSubmit={submit} data-testid="payroll-form">
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Loại">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={activeKind === k}
              onClick={() => {
                setKind(k);
                setError(null);
              }}
              className="btn btn-segment"
              data-testid={`payroll-kind-${k}`}
            >
              {PAYROLL_KIND_SHORT[k]}
            </button>
          ))}
        </div>
        <TextField label={label} inputMode={activeKind === 'days' ? 'text' : 'numeric'} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="payroll-amount" />
        <TextField label="Ghi chú (tùy chọn)" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} data-testid="payroll-note" />
        <ErrorText testId="payroll-form-error">{error}</ErrorText>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="payroll-submit">
          {button}
        </button>
      </form>
    </Card>
  );
}

const dayTime = (at: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date(at)) + ' ' + hhmm(at);

function Ledger({ entries, onVoid }: { entries: PayrollEntry[]; onVoid: (e: PayrollEntry) => void }) {
  return (
    <Card title="Sổ lương tháng này">
      {entries.length === 0 && <p className="text-ink-subtle">Chưa ghi gì.</p>}
      <ul className="flex flex-col divide-y divide-line" data-testid="payroll-ledger">
        {entries.map((e) => {
          const voided = !!e.voided_at;
          return (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2" data-testid="payroll-entry" data-kind={e.kind} data-voided={voided || undefined}>
              <span className={`min-w-0 ${voided ? 'text-ink-subtle line-through' : ''}`}>
                <span className="block font-medium">
                  {PAYROLL_KIND_LABELS[e.kind]} <span className="num">{amountLabel(e)}</span>
                </span>
                <span className="block truncate text-sm text-ink-subtle">
                  {dayTime(e.at)}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
              </span>
              {voided ? (
                <span className="shrink-0 text-sm text-ink-subtle">Đã hủy</span>
              ) : (
                <button type="button" className="btn btn-secondary shrink-0" onClick={() => onVoid(e)} data-testid="payroll-entry-void">
                  Hủy
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/** 270 → "4h30", 480 → "8h". */
const shortHours = (min: number) => {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
};

/** Lịch tháng: ngày có mở ca tô màu (kèm tổng giờ), bấm một ngày để xem các ca của ngày đó. */
function WorkCalendar({ data, ym, p, birthday }: { data: PayrollMonth; ym: string; p: Payslip; birthday: string | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [ym]);
  const today = businessDate(new Date());
  const weeks = monthGrid(ym);
  const work = workDays(data.shifts);
  const elapsed = weeks.flat().filter((d): d is string => !!d && d <= today).length;
  const off = Math.max(0, elapsed - p.shiftDays);
  const adj = p.days - p.shiftDays;
  // Sinh nhật rơi vào tháng đang xem (29/2 ở năm không nhuận thì không có ô ⇒ bỏ).
  const bdayCell = birthday && birthday.slice(5, 7) === ym.slice(5) ? `${ym}-${birthday.slice(8)}` : null;
  const bday = bdayCell && weeks.flat().includes(bdayCell) ? bdayCell : null;
  const shifts = picked ? data.shifts.filter((s) => businessDate(s.opened_at) === picked) : data.shifts;

  return (
    <Card title="Lịch làm việc">
      <p className="text-sm text-ink-muted" data-testid="payroll-calendar-summary">
        Đi làm <b className="text-ink">{p.shiftDays} ngày</b>
        {elapsed > 0 && <> · nghỉ {off} ngày</>}
        {ym === today.slice(0, 7) && ' (tính tới hôm nay)'}
        {adj !== 0 && (
          <>
            {' · '}chủ chỉnh {adj > 0 ? '+' : ''}
            {adj} ⇒ <b className="text-ink">{p.days} ngày công</b>
          </>
        )}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`Lịch ${monthLabel(ym).toLowerCase()}`} data-testid="payroll-calendar">
        {WEEKDAYS.map((w, i) => (
          <span key={w} role="columnheader" className={`pb-1 text-xs font-semibold ${i === 6 ? 'text-danger-strong' : 'text-ink-subtle'}`}>
            {w}
          </span>
        ))}
        {weeks.flat().map((d, i) => {
          if (!d) return <span key={`x${i}`} aria-hidden />;
          const w = work.get(d);
          const future = d > today;
          const selected = picked === d;
          const isBday = d === bday;
          const tone = selected
            ? 'border-brand-strong bg-brand text-white'
            : w
              ? 'border-brand-line bg-brand-soft text-brand-deep'
              : isBday
                ? 'border-danger-line text-danger-strong'
                : future
                  ? 'border-transparent text-ink-subtle/60'
                  : 'border-line text-ink-muted';
          const label = `${formatDate(d)}${w ? `: ${w.shifts} ca, ${formatMinutes(w.minutes)}${w.open ? ', đang mở' : ''}` : future ? '' : ': nghỉ'}${isBday ? ', sinh nhật' : ''}`;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              aria-label={label}
              aria-selected={selected}
              disabled={!w}
              onClick={() => setPicked(selected ? null : d)}
              className={`relative flex min-h-[52px] flex-col items-center justify-center rounded-lg border transition-colors duration-fast ${tone} ${
                d === today ? 'ring-2 ring-brand ring-offset-1 ring-offset-surface' : ''
              } ${w && !selected ? 'hover:border-brand-strong' : ''}`}
              data-testid={`payroll-day-${d}`}
              data-worked={w ? true : undefined}
            >
              <span className={`num text-base leading-none ${w ? 'font-bold' : ''}`}>{Number(d.slice(8))}</span>
              {w && (
                <span className={`num mt-1 whitespace-nowrap text-[11px] leading-none ${selected ? 'text-white/90' : 'text-brand-strong'}`}>
                  {w.open ? (
                    <>
                      <span className="hidden sm:inline">đang </span>mở
                    </>
                  ) : (
                    shortHours(w.minutes)
                  )}
                  {w.shifts > 1 && !w.open ? ` · ${w.shifts}` : ''}
                </span>
              )}
              {isBday && <Cake aria-hidden className={`absolute right-0.5 top-0.5 h-3 w-3 sm:h-3.5 sm:w-3.5 ${selected ? 'text-white' : 'text-danger-strong'}`} />}
            </button>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-subtle">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded border border-brand-line bg-brand-soft" /> Có mở ca (tổng giờ · số ca)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded border border-line" /> Nghỉ
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded ring-2 ring-brand" /> Hôm nay
        </span>
        {bday && (
          <span className="flex items-center gap-1.5">
            <Cake aria-hidden className="h-3.5 w-3.5 text-danger-strong" /> Sinh nhật
          </span>
        )}
      </p>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <h3 className="font-semibold">{picked ? `Ca ngày ${formatDate(picked).slice(0, 5)}` : `Các ca trong tháng (${data.shifts.length})`}</h3>
        {picked && (
          <button type="button" className="text-sm text-brand-strong underline" onClick={() => setPicked(null)} data-testid="payroll-day-clear">
            Xem cả tháng
          </button>
        )}
      </div>
      {shifts.length === 0 && <p className="text-ink-subtle">Không có ca nào.</p>}
      <ul className="flex flex-col divide-y divide-line" data-testid="payroll-shifts">
        {shifts.map((s) => (
          <li key={s.id}>
            <Link to={`/owner/shifts/${s.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface-muted">
              <span>
                <span className="font-medium">{formatDate(businessDate(s.opened_at)).slice(0, 5)}</span>{' '}
                <span className="num text-ink-muted">
                  {hhmm(s.opened_at)}–{s.closed_at ? hhmm(s.closed_at) : '…'}
                </span>{' '}
                <span className="text-sm text-ink-subtle">· {s.tablet_name}</span>
              </span>
              <span className="num shrink-0 text-sm text-ink-muted">
                {s.closed_at ? formatMinutes(Math.round(minutesBetween(s.opened_at, s.closed_at))) : 'đang mở'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  testId,
  strong,
  divider,
  tone,
}: {
  label: string;
  value: string;
  testId: string;
  strong?: boolean;
  divider?: boolean;
  tone?: string;
}) {
  return (
    <p className={`flex items-baseline justify-between gap-3 ${divider ? 'border-t border-line pt-2' : ''}`}>
      <span className="text-ink-muted">{label}</span>
      <span className={`num text-right ${strong ? 'text-lg font-bold' : ''} ${tone ?? ''}`} data-testid={testId}>
        {value}
      </span>
    </p>
  );
}
