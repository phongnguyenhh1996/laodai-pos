import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Cake, ChevronLeft, ChevronRight } from 'lucide-react';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import {
  DAY_MARK_REASON_MAX, PAYROLL_KIND_LABELS, PAYROLL_KIND_SHORT, computePayslip, daysUntilBirthday, formatDate, formatMinutes, formatPhone, isMonth, monthGrid,
  monthLabel, monthOf, parseDayMarkReason, parseDaysInput, shiftMonth, workDays, type DayMark, type DayMarkKind, type PayrollEntry, type PayrollKind, type Payslip,
} from '@/domain/payroll';
import { businessDate, hhmm, minutesBetween } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { addDayMark, addPayrollEntry, loadPayrollMonth, removeDayMark, updateDayMark, voidPayrollEntry, type PayrollMonth } from './api';

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
        .map((s) => ({ s, p: computePayslip(data.details.find((d) => d.id === s.id) ?? null, data.shifts.filter((x) => x.staff_id === s.id), data.entries.filter((e) => e.staff_id === s.id), ym, data.marks.filter((m) => m.staff_id === s.id)) }))
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
  const p = data && computePayslip(details, data.shifts, data.entries, ym, data.marks);

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
          <WorkCalendar data={data} staffId={s.id} ym={ym} p={p} birthday={details?.birthday ?? null} onChanged={reload} />
          <EntryForm staffId={s.id} ym={ym} remaining={p.remaining} onSaved={reload} />
          <Ledger entries={data.entries} onVoid={(e) => void voidEntry(e)} />
        </>
      )}
    </OwnerLayout>
  );
}

function WorkRows({ p }: { p: Payslip }) {
  const adj = p.days - p.shiftDays - p.markedDays;
  const parts = [`có ca ${p.shiftDays}`];
  if (p.markedDays) parts.push(`đánh có làm ${p.markedDays}`);
  if (adj) parts.push(`chỉnh ${adj > 0 ? '+' : ''}${adj}`);
  return (
    <>
      <Row label="Số ca" value={`${p.shifts} ca`} testId="payslip-shifts" />
      <Row label="Ngày công" value={`${p.days} ngày${parts.length > 1 ? ` (${parts.join(', ')})` : ''}`} testId="payslip-days" />
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

const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const weekdayName = (ymd: string) => WEEKDAY_NAMES[new Date(`${ymd}T00:00:00Z`).getUTCDay()];

/**
 * Lịch tháng: ngày có mở ca tô màu (kèm tổng giờ), ngày chủ đánh "có làm" viền đứt (+1 công), đánh nghỉ tô vàng.
 * Bấm một ngày để xem các ca của ngày đó, hoặc đánh / đổi / bỏ đánh dấu (kèm lý do không bắt buộc).
 */
function WorkCalendar({
  data,
  staffId,
  ym,
  p,
  birthday,
  onChanged,
}: {
  data: PayrollMonth;
  staffId: string;
  ym: string;
  p: Payslip;
  birthday: string | null;
  onChanged: () => Promise<void>;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [ym]);
  const today = businessDate(new Date());
  const weeks = monthGrid(ym);
  const work = workDays(data.shifts);
  const marks = new Map(data.marks.map((m) => [m.day, m]));
  const offCount = data.marks.filter((m) => m.kind === 'off').length;
  // Ngày đã qua không có ca, cũng không đánh "có làm".
  const idle = weeks.flat().filter((d): d is string => !!d && d <= today && !work.has(d) && marks.get(d)?.kind !== 'work').length;
  const adj = p.days - p.shiftDays - p.markedDays;
  // Sinh nhật rơi vào tháng đang xem (29/2 ở năm không nhuận thì không có ô ⇒ bỏ).
  const bdayCell = birthday && birthday.slice(5, 7) === ym.slice(5) ? `${ym}-${birthday.slice(8)}` : null;
  const bday = bdayCell && weeks.flat().includes(bdayCell) ? bdayCell : null;
  const shifts = picked ? data.shifts.filter((s) => businessDate(s.opened_at) === picked) : data.shifts;

  return (
    <Card title="Lịch làm việc">
      <p className="text-sm text-ink-muted" data-testid="payroll-calendar-summary">
        Có ca <b className="text-ink">{p.shiftDays} ngày</b>
        {p.markedDays > 0 && (
          <>
            {' · '}đánh có làm <b className="text-brand-strong">{p.markedDays} ngày</b>
          </>
        )}
        {adj !== 0 && (
          <>
            {' · '}chủ chỉnh {adj > 0 ? '+' : ''}
            {adj}
          </>
        )}
        {(p.markedDays > 0 || adj !== 0) && (
          <>
            {' ⇒ '}
            <b className="text-ink">{p.days} ngày công</b>
          </>
        )}
        {offCount > 0 && (
          <>
            {' · '}đánh nghỉ <b className="text-warning-strong">{offCount} ngày</b>
          </>
        )}
        {idle > 0 && <> · không có ca {idle} ngày</>}
        {ym === today.slice(0, 7) && ' (tính tới hôm nay)'}
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
          const mk = marks.get(d);
          const o = mk?.kind === 'off' ? mk : undefined;
          const extra = mk?.kind === 'work' && !w ? mk : undefined; // có làm, không mở ca ⇒ +1 công
          const future = d > today;
          const selected = picked === d;
          const isBday = d === bday;
          const tone = selected
            ? 'border-brand-strong bg-brand text-white'
            : w
              ? 'border-brand-line bg-brand-soft text-brand-deep hover:border-brand-strong'
              : extra
                ? 'border-dashed border-brand bg-brand-soft/60 text-brand-deep hover:border-brand-strong'
                : o
                ? 'border-warning-line bg-warning-soft text-warning-strong hover:border-warning-strong'
                : isBday
                  ? 'border-danger-line text-danger-strong hover:bg-surface-muted'
                  : future
                    ? 'border-transparent text-ink-subtle/60 hover:border-line'
                    : 'border-line text-ink-muted hover:bg-surface-muted';
          const label = [
            formatDate(d),
            w ? `${w.shifts} ca, ${formatMinutes(w.minutes)}${w.open ? ', đang mở' : ''}` : '',
            mk ? `đánh ${mk.kind === 'off' ? 'nghỉ' : 'có làm'}${mk.reason ? `: ${mk.reason}` : ''}` : '',
            isBday ? 'sinh nhật' : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              aria-label={label}
              aria-selected={selected}
              title={mk?.reason ?? undefined}
              onClick={() => setPicked(selected ? null : d)}
              className={`relative flex min-h-[52px] flex-col items-center justify-center rounded-lg border transition-colors duration-fast ${tone} ${
                d === today ? 'ring-2 ring-brand ring-offset-1 ring-offset-surface' : ''
              }`}
              data-testid={`payroll-day-${d}`}
              data-worked={w ? true : undefined}
              data-mark={mk?.kind}
            >
              <span className={`num text-base leading-none ${w || mk ? 'font-bold' : ''}`}>{Number(d.slice(8))}</span>
              {w ? (
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
              ) : (
                mk && (
                  <span className={`mt-1 text-[11px] leading-none ${selected ? 'text-white/90' : mk.kind === 'work' ? 'text-brand-strong' : ''}`}>
                    {mk.kind === 'off' ? 'nghỉ' : 'làm'}
                  </span>
                )
              )}
              {w && mk && <span aria-hidden className={`absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full ${mk.kind === 'off' ? 'bg-warning' : 'bg-brand'}`} />}
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
          <span aria-hidden className="h-3 w-3 rounded border border-dashed border-brand bg-brand-soft/60" /> Đánh có làm (+1 công)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded border border-warning-line bg-warning-soft" /> Đánh nghỉ
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded border border-line" /> Không có ca
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
        <h3 className="font-semibold" data-testid="payroll-day-title">
          {picked ? `${weekdayName(picked)}, ${formatDate(picked)}` : `Các ca trong tháng (${data.shifts.length})`}
        </h3>
        {picked ? (
          <button type="button" className="text-sm text-brand-strong underline" onClick={() => setPicked(null)} data-testid="payroll-day-clear">
            Xem cả tháng
          </button>
        ) : (
          <span className="text-sm text-ink-subtle">Bấm vào ngày để xem ca / đánh nghỉ, có làm</span>
        )}
      </div>
      {picked && (
        <DayMarkForm key={`${picked}:${marks.get(picked)?.id ?? ''}`} staffId={staffId} day={picked} mark={marks.get(picked) ?? null} hasShifts={shifts.length > 0} onSaved={onChanged} />
      )}
      {!picked && shifts.length === 0 && <p className="text-ink-subtle">Không có ca nào.</p>}
      {shifts.length > 0 && (
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
      )}
    </Card>
  );
}

const REASON_CHIPS: Record<DayMarkKind, string[]> = {
  off: ['Có phép', 'Không phép', 'Ốm', 'Việc nhà'],
  work: ['Quên mở ca', 'Đi chợ / lấy hàng', 'Làm ở bếp'],
};
const MARK_KINDS: DayMarkKind[] = ['off', 'work'];

/**
 * Đánh dấu một ngày: "Nghỉ" (chỉ ghi nhận) hoặc "Có làm" (làm mà không mở ca ⇒ +1 ngày công); lý do / ghi chú không bắt buộc.
 * Ngày đã có ca thì không cần đánh dấu (chỉ hiện khi ngày đó đã lỡ đánh trước để còn bỏ / sửa).
 */
function DayMarkForm({
  staffId,
  day,
  mark,
  hasShifts,
  onSaved,
}: {
  staffId: string;
  day: string;
  mark: DayMark | null;
  hasShifts: boolean;
  onSaved: () => Promise<void>;
}) {
  const { client } = useOwner();
  const [kind, setKind] = useState<DayMarkKind>(mark?.kind ?? 'off');
  const [reason, setReason] = useState(mark?.reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const r = parseDayMarkReason(reason);
      if (mark) await updateDayMark(client, mark.id, { kind, reason: r });
      else await addDayMark(client, staffId, day, kind, r);
    });
  }

  // Ngày có ca mà chưa đánh dấu: chỉ xem ca.
  if (hasShifts && !mark) return null;

  const changed = !mark || kind !== mark.kind || (parseSafe(reason) ?? null) !== (mark.reason ?? null);
  const dd = formatDate(day).slice(0, 5);
  const tone = mark?.kind === 'work' ? 'border-brand-line bg-brand-tint' : mark ? 'border-warning-line bg-warning-tint' : 'border-line bg-surface-muted';
  return (
    <form className={`flex flex-col gap-3 rounded-lg border p-3 ${tone}`} onSubmit={submit} data-testid="payroll-daymark">
      {mark ? (
        <p className={`font-medium ${mark.kind === 'work' ? 'text-brand-deep' : 'text-warning-strong'}`} data-testid="payroll-daymark-status">
          Đã đánh {mark.kind === 'work' ? 'có làm' : 'nghỉ'}
          {mark.reason ? ` · ${mark.reason}` : ''}
          {hasShifts && <span className="block text-sm font-normal text-ink-muted">Ngày này có mở ca nên đã tính 1 ngày công theo ca.</span>}
        </p>
      ) : (
        <p className="text-sm text-ink-muted">Không có ca. Đánh nghỉ để ghi nhận, hoặc đánh có làm nếu làm mà không mở ca (+1 ngày công).</p>
      )}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Loại">
        {MARK_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            className="btn btn-choice"
            onClick={() => {
              if (kind !== k && REASON_CHIPS[kind].includes(reason.trim())) setReason('');
              setKind(k);
            }}
            data-testid={`payroll-daymark-kind-${k}`}
          >
            {k === 'off' ? 'Nghỉ' : 'Có làm (+1 công)'}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Lý do nhanh">
        {REASON_CHIPS[kind].map((c) => (
          <button
            key={c}
            type="button"
            className="btn btn-choice min-h-0 px-3 py-1.5 text-sm"
            aria-pressed={reason.trim() === c}
            onClick={() => setReason(reason.trim() === c ? '' : c)}
            data-testid="payroll-daymark-chip"
          >
            {c}
          </button>
        ))}
      </div>
      <TextField
        label={kind === 'off' ? 'Lý do (không bắt buộc)' : 'Ghi chú (không bắt buộc)'}
        value={reason}
        maxLength={DAY_MARK_REASON_MAX}
        onChange={(e) => setReason(e.target.value)}
        data-testid="payroll-daymark-reason"
      />
      <ErrorText testId="payroll-daymark-error">{error}</ErrorText>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" className="btn btn-primary flex-1" disabled={busy || !changed} data-testid="payroll-daymark-save">
          {mark ? 'Lưu' : kind === 'off' ? `Đánh nghỉ ${dd}` : `Đánh có làm ${dd}`}
        </button>
        {mark && (
          <button
            type="button"
            className="btn btn-secondary flex-1"
            disabled={busy}
            onClick={() => void run(() => removeDayMark(client, mark.id))}
            data-testid="payroll-daymark-remove"
          >
            Bỏ đánh dấu
          </button>
        )}
      </div>
    </form>
  );
}

function parseSafe(raw: string): string | null | undefined {
  try {
    return parseDayMarkReason(raw);
  } catch {
    return undefined;
  }
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
