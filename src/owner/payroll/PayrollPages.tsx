import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Cake, ChevronLeft, ChevronRight, FileText, Info, Plus } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import {
  DAY_MARK_REASON_MAX,
  PAYROLL_KIND_LABELS,
  PAYROLL_KIND_SHORT,
  computePayslip,
  daysUntilBirthday,
  formatDate,
  formatMinutes,
  formatPhone,
  isMonth,
  monthGrid,
  monthLabel,
  monthOf,
  parseDayMarkReason,
  parseDaysInput,
  shiftMonth,
  workDays,
  type DayMark,
  type DayMarkKind,
  type PayrollEntry,
  type PayrollKind,
  type Payslip,
} from '@/domain/payroll';
import { businessDate, dayTime, hhmm, minutesBetween } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { Chip, OwnerLayout } from '../OwnerLayout';
import { IconTile, Section, TONE, btn, card } from '../ui';
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
  const tile =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f8f8f8] text-[#111] transition-colors duration-fast hover:bg-[#efefef] disabled:cursor-not-allowed disabled:text-[#c4c4c4] disabled:hover:bg-[#f8f8f8]';
  return (
    <div className="flex items-center justify-between gap-2 rounded-[14px] border border-line bg-white p-2" data-testid="payroll-month">
      <button type="button" className={tile} aria-label="Tháng trước" onClick={() => onChange(shiftMonth(ym, -1))} data-testid="payroll-prev">
        <ChevronLeft aria-hidden className="h-[18px] w-[18px]" />
      </button>
      <span className="flex flex-col items-center gap-px text-center">
        <b className="text-[15px] leading-[19px]" data-testid="payroll-month-label">
          {monthLabel(ym)}
        </b>
        {ym === current && <span className="text-[11px] leading-[14px] text-[#888]">Tháng này · còn đang tính</span>}
      </span>
      <button type="button" className={tile} aria-label="Tháng sau" disabled={ym >= current} onClick={() => onChange(shiftMonth(ym, 1))} data-testid="payroll-next">
        <ChevronRight aria-hidden className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}

const rateLabel = (p: Pick<Payslip, 'rate'>) => (p.rate ? `${formatVnd(p.rate)} / ngày` : 'Chưa đặt lương ngày');
const initial = (name: string) => name.trim().charAt(0).toUpperCase();

/** "Còn phải trả" có dấu: trả dư thì âm, đỏ. */
function remainingText(p: Pick<Payslip, 'remaining'>): string {
  return p.remaining < 0 ? `−${formatVnd(-p.remaining)}` : formatVnd(p.remaining);
}

// ---------------------------------------------------------------- danh sách

/** `/owner/payroll?m=YYYY-MM`. Figma R29 / T30. */
function PayrollList() {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const [ym, setYm] = useMonth();
  const { data, error } = useLoad(useCallback(() => loadPayrollMonth(client, ym), [client, ym]));

  const rows = data
    ? data.staff
        .map((s) => ({
          s,
          p: computePayslip(
            data.details.find((d) => d.id === s.id) ?? null,
            data.shifts.filter((x) => x.staff_id === s.id),
            data.entries.filter((e) => e.staff_id === s.id),
            ym,
            data.marks.filter((m) => m.staff_id === s.id),
          ),
        }))
        // Nhân viên nghỉ việc chỉ hiện ở tháng họ còn có ca / sổ lương.
        .filter(({ s, p }) => s.active || p.shifts > 0 || p.total !== 0 || p.advance + p.payment > 0)
    : [];
  const sum = (k: 'total' | 'remaining') => rows.reduce((t, r) => t + r.p[k], 0);
  const paid = rows.reduce((t, r) => t + r.p.advance + r.p.payment, 0);

  const list = data && (
    <div className={`${card} overflow-hidden`}>
      <p className="flex items-center justify-between bg-[#f8f8f8] px-3.5 py-2.5 text-xs font-medium leading-[15px] text-[#6d6d6d]">
        <span>Nhân viên</span>
        <span>Còn phải trả</span>
      </p>
      {rows.length === 0 && <p className="px-3.5 py-5 text-center text-sm text-[#888]">Chưa có nhân viên.</p>}
      {rows.map(({ s, p }) => (
        <Link
          key={s.id}
          to={`${PAYROLL}/${s.id}?m=${ym}`}
          className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-3 transition-colors duration-fast first-of-type:border-t-0 hover:bg-[#fafafa]"
          data-testid={`payroll-row-${s.id}`}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${s.active ? TONE.orange : TONE.gray}`}>
              {initial(s.name)}
            </span>
            <span className="flex min-w-0 flex-col gap-[3px]">
              <span className={`truncate text-[15px] font-semibold leading-[19px] ${s.active ? '' : 'text-[#888]'}`}>
                {s.name}
                {!s.active && ' (nghỉ)'}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs leading-[15px] text-[#888]">
                <span className="shrink-0">{p.days} ngày công</span>
                {p.rate ? (
                  <span className="truncate">· {rateLabel(p)}</span>
                ) : (
                  <span className={`truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-[13px] ${TONE.amber}`}>Chưa đặt lương ngày</span>
                )}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="sr-only" data-testid={`payroll-row-${s.id}-total`}>
              Lương tháng {formatVnd(p.total)}
            </span>
            <b className={`num text-[15px] leading-[19px] ${p.remaining < 0 ? 'text-[#b91c1c]' : ''}`} data-testid={`payroll-row-${s.id}-remaining`}>
              {remainingText(p)}
            </b>
            <ChevronRight aria-hidden className="h-4 w-4 text-[#888]" />
          </span>
        </Link>
      ))}
    </div>
  );
  const aside = data && (
    <>
      <Birthdays data={data} ym={ym} />
      <p className="flex gap-2.5 rounded-xl bg-[#f8f8f8] px-3.5 py-3 text-[13px] leading-[19px] text-[#6d6d6d]">
        <Info aria-hidden className="mt-px h-[18px] w-[18px] shrink-0" />
        <span>
          Lương tính theo ngày: ngày công là số ngày nhân viên có mở ca (nhiều ca trong ngày vẫn tính 1 ngày). Chủ cộng / trừ ngày công trong từng nhân viên. Lương một ngày sửa ở{' '}
          <Link to="/owner/settings/staff" className="font-semibold text-brand hover:underline">
            Cài đặt › Nhân viên
          </Link>
          .
        </span>
      </p>
    </>
  );

  return (
    <OwnerLayout title="Lương" subtitle={isTablet ? 'Công theo ca · thưởng / trừ / ứng / trả' : undefined} back={isTablet ? '/owner' : '/owner/more'} tabBar wide testId="payroll-list">
      <div className="flex flex-col gap-3.5 md:gap-5">
        <MonthPicker ym={ym} onChange={setYm} />
        <ErrorText testId="payroll-error">{error}</ErrorText>
        {!data && !error && <Splash />}
        {data && (
          <>
            <section className="grid grid-cols-3 gap-2" data-testid="payroll-totals">
              <Stat label="Tổng lương" value={formatVnd(sum('total'))} testId="payroll-total" />
              <Stat label="Đã ứng / trả" value={formatVnd(paid)} testId="payroll-paid" />
              <Stat label="Còn phải trả" value={formatVnd(sum('remaining'))} testId="payroll-remaining" strong />
            </section>
            {isTablet ? (
              <div className="grid grid-cols-[minmax(0,506fr)_minmax(0,338fr)] items-start gap-5">
                {list}
                <div className="flex flex-col gap-4">{aside}</div>
              </div>
            ) : (
              <>
                {list}
                {aside}
              </>
            )}
          </>
        )}
      </div>
    </OwnerLayout>
  );
}

function Stat({ label, value, testId, strong }: { label: string; value: string; testId: string; strong?: boolean }) {
  return (
    <span className={`flex min-w-0 flex-col gap-0.5 rounded-xl p-3 ${strong ? 'bg-brand text-white' : 'bg-[#f8f8f8]'}`}>
      <span className={`truncate text-[11px] font-medium leading-[14px] ${strong ? 'text-white/85' : 'text-[#888]'}`}>{label}</span>
      <b className="num truncate text-lg leading-[23px]" data-testid={testId}>
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
    <p className={`${card} flex-row items-center gap-3 px-3.5 py-3`} data-testid="payroll-birthdays">
      <IconTile icon={Cake} className="h-[34px] w-[34px] rounded-[10px]" iconClass="h-[17px] w-[17px]" tone={TONE.red} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <b className="text-sm leading-[18px]">Sinh nhật trong tháng</b>
        <span className="text-xs leading-[15px] text-[#6d6d6d]">
          {list.map(({ s, b }, i) => (
            <span key={s.id}>
              {i > 0 && ' · '}
              {s.name} ({formatDate(b).slice(0, 5)}
              {ym === today.slice(0, 7) && daysUntilBirthday(b, today) === 0 ? ' · hôm nay' : ''})
            </span>
          ))}
        </span>
      </span>
    </p>
  );
}

// ---------------------------------------------------------------- một nhân viên

/** `/owner/payroll/:staffId?m=YYYY-MM`. Figma R30 / T31. */
function StaffPayroll() {
  const { staffId = '' } = useParams();
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const [ym, setYm] = useMonth();
  const { data, error, reload } = useLoad(useCallback(() => loadPayrollMonth(client, ym, staffId), [client, ym, staffId]));
  const [actionError, setActionError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [ym]);

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

  const body =
    data && s && p
      ? {
          slip: <PayslipCard p={p} staffId={s.id} phone={details?.phone ?? null} />,
          calendar: <WorkCalendar data={data} staffId={s.id} ym={ym} p={p} birthday={details?.birthday ?? null} picked={picked} onPick={setPicked} onChanged={reload} />,
          shifts: <MonthShifts data={data} picked={picked} onClear={() => setPicked(null)} />,
          form: <EntryForm staffId={s.id} ym={ym} remaining={p.remaining} onSaved={reload} />,
          ledger: <Ledger entries={data.entries} onVoid={(e) => void voidEntry(e)} />,
        }
      : null;

  return (
    <OwnerLayout
      title={s ? `Lương · ${s.name}` : 'Lương'}
      subtitle={isTablet ? `${monthLabel(ym)}${ym === monthOf(new Date()) ? ' · còn đang tính' : ''}` : undefined}
      back={`${PAYROLL}?m=${ym}`}
      tabBar
      wide
      testId="payroll-staff"
    >
      <div className="flex flex-col gap-3.5 md:gap-5">
        <MonthPicker ym={ym} onChange={setYm} />
        <ErrorText testId="payroll-error">{error ?? actionError}</ErrorText>
        {!data && !error && <Splash />}
        {data && !s && <p className="text-sm text-[#888]">Không có nhân viên này.</p>}
        {body &&
          (isTablet ? (
            <div className="grid grid-cols-2 items-start gap-5">
              <div className="flex flex-col gap-4">
                {body.calendar}
                {body.shifts}
              </div>
              <div className="flex flex-col gap-4">
                {body.slip}
                {body.form}
                {body.ledger}
              </div>
            </div>
          ) : (
            <>
              {body.slip}
              {body.calendar}
              {body.shifts}
              {body.form}
              {body.ledger}
            </>
          ))}
      </div>
    </OwnerLayout>
  );
}

/** Thẻ "Bảng lương". */
function PayslipCard({ p, staffId, phone }: { p: Payslip; staffId: string; phone: string | null }) {
  return (
    <Section title="Bảng lương">
      <div className="flex flex-col">
        <p className="flex items-center justify-between gap-2.5 py-2 text-sm leading-[18px]">
          <span className="text-[#6d6d6d]">Cách tính</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`truncate rounded-full px-2.5 py-1 text-[11px] font-semibold leading-[14px] ${p.rate ? TONE.green : TONE.amber}`} data-testid="payroll-rate">
              Theo ngày · {p.rate ? rateLabel(p) : 'chưa đặt lương'}
            </span>
            <Link to={`/owner/settings/staff/${staffId}`} className="shrink-0 text-[13px] font-semibold text-brand hover:underline" data-testid="payroll-edit-rate">
              Sửa
            </Link>
          </span>
        </p>
        {phone && (
          <Row label="Điện thoại">
            <a href={`tel:${phone}`} className="text-brand hover:underline" data-testid="payroll-phone">
              {formatPhone(phone)}
            </a>
          </Row>
        )}
        <WorkRows p={p} />
        <Row label={`Lương ngày công (${p.days} × ${formatVnd(p.rate)})`} testId="payslip-base">
          {formatVnd(p.base)}
        </Row>
        {p.bonus > 0 && (
          <Row label="+ Thưởng / phụ cấp" testId="payslip-bonus">
            {formatVnd(p.bonus)}
          </Row>
        )}
        {p.deduction > 0 && (
          <Row label="− Trừ lương" testId="payslip-deduction">
            {formatVnd(p.deduction)}
          </Row>
        )}
        <Row label="Lương tháng" testId="payslip-total">
          {formatVnd(p.total)}
        </Row>
        {p.advance > 0 && (
          <Row label="− Đã ứng" testId="payslip-advance">
            {formatVnd(p.advance)}
          </Row>
        )}
        {p.payment > 0 && (
          <Row label="− Đã trả" testId="payslip-payment">
            {formatVnd(p.payment)}
          </Row>
        )}
        <p className="mt-1 flex items-center justify-between gap-2.5 border-t border-line pt-3 text-sm font-semibold leading-[18px]">
          <span>{p.remaining < 0 ? 'Trả dư' : 'Còn phải trả'}</span>
          <b className={`num text-base leading-5 ${p.remaining > 0 ? 'text-[#c2380a]' : p.remaining < 0 ? 'text-[#b91c1c]' : ''}`} data-testid="payslip-remaining">
            {formatVnd(Math.abs(p.remaining))}
          </b>
        </p>
      </div>
    </Section>
  );
}

function WorkRows({ p }: { p: Payslip }) {
  const adj = p.days - p.shiftDays - p.markedDays;
  const parts = [`có ca ${p.shiftDays}`];
  if (p.markedDays) parts.push(`đánh có làm ${p.markedDays}`);
  if (adj) parts.push(`chỉnh ${adj > 0 ? '+' : ''}${adj}`);
  return (
    <>
      <Row label="Số ca" testId="payslip-shifts">{`${p.shifts} ca`}</Row>
      <Row label="Ngày công" testId="payslip-days">{`${p.days} ngày${parts.length > 1 ? ` (${parts.join(', ')})` : ''}`}</Row>
    </>
  );
}

function amountLabel(e: Pick<PayrollEntry, 'kind' | 'amount'>): string {
  if (e.kind === 'days') return `${e.amount > 0 ? '+' : ''}${e.amount} ngày`;
  return formatVnd(e.amount);
}

const KINDS: PayrollKind[] = ['advance', 'payment', 'bonus', 'deduction', 'days'];

function EntryForm({ staffId, ym, remaining, onSaved }: { staffId: string; ym: string; remaining: number; onSaved: () => Promise<void> }) {
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
    <Section
      title="Ghi sổ lương"
      right={
        remaining > 0 && (
          <button
            type="button"
            className="shrink-0 rounded-full bg-[#e8f7ee] px-3 py-1.5 text-xs font-semibold leading-[15px] text-[#15803d] hover:bg-[#d5f0df] disabled:opacity-40"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Ghi đã trả ${formatVnd(remaining)} lương ${monthLabel(ym).toLowerCase()}?`)) void save('payment', remaining, 'Trả đủ lương tháng');
            }}
            data-testid="payroll-pay-all"
          >
            Trả đủ {formatVnd(remaining)}
          </button>
        )
      }
    >
      <form className="flex flex-col gap-3.5" onSubmit={submit} data-testid="payroll-form">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Loại">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={activeKind === k}
              onClick={() => {
                setKind(k);
                setError(null);
              }}
              className={pill(activeKind === k)}
              data-testid={`payroll-kind-${k}`}
            >
              {PAYROLL_KIND_SHORT[k]}
            </button>
          ))}
        </div>
        <Field label={label} suffix={activeKind === 'days' ? 'ngày' : 'đ'}>
          <input inputMode={activeKind === 'days' ? 'text' : 'numeric'} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={INPUT} data-testid="payroll-amount" />
        </Field>
        <Field label="Ghi chú (tùy chọn)">
          <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="VD: ứng tiền xe" className={INPUT} data-testid="payroll-note" />
        </Field>
        <ErrorText testId="payroll-form-error">{error}</ErrorText>
        <button type="submit" className={btn('brand', 'min-h-[45px] text-[15px] leading-[19px]')} disabled={busy} data-testid="payroll-submit">
          <Plus aria-hidden className="h-[17px] w-[17px]" />
          {button}
        </button>
      </form>
    </Section>
  );
}

/** Chip bo tròn chọn loại / lý do (Figma "Ứng lương", "Trả lương"…). */
const pill = (on: boolean) =>
  `inline-flex h-[34px] items-center rounded-full px-3 text-[13px] font-semibold leading-4 transition-colors duration-fast ${
    on ? 'bg-brand text-white' : 'border border-line bg-white text-[#111] hover:bg-[#f8f8f8]'
  }`;

const INPUT = 'min-w-0 flex-1 bg-transparent text-[15px] leading-[19px] text-[#111] outline-none placeholder:text-[#a3a3a3] focus-visible:ring-0';

/** Ô nhập cao 45 có nhãn 13 xám và đơn vị bên phải. */
function Field({ label, suffix, children }: { label: string; suffix?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium leading-4 text-[#6d6d6d]">{label}</span>
      <span className="flex h-[45px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 focus-within:border-brand">
        {children}
        {suffix && <span className="shrink-0 text-[13px] text-[#888]">{suffix}</span>}
      </span>
    </label>
  );
}

function Ledger({ entries, onVoid }: { entries: PayrollEntry[]; onVoid: (e: PayrollEntry) => void }) {
  return (
    <Section title="Sổ lương tháng này">
      {entries.length === 0 && (
        <p className="flex flex-col items-center gap-1.5 rounded-xl bg-[#f8f8f8] px-3 py-[18px] text-[13px] leading-4 text-[#888]">
          <FileText aria-hidden className="h-[22px] w-[22px]" />
          Chưa ghi gì
        </p>
      )}
      {entries.length > 0 && (
        <ul className="-mt-1 flex flex-col" data-testid="payroll-ledger">
          {entries.map((e) => {
            const voided = !!e.voided_at;
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0"
                data-testid="payroll-entry"
                data-kind={e.kind}
                data-voided={voided || undefined}
              >
                <span className={`flex min-w-0 flex-col gap-0.5 ${voided ? 'text-[#a3a3a3] line-through' : ''}`}>
                  <span className="text-sm font-semibold leading-[18px]">
                    {PAYROLL_KIND_LABELS[e.kind]} <span className="num">{amountLabel(e)}</span>
                  </span>
                  <span className={`truncate text-xs leading-[15px] ${voided ? '' : 'text-[#888]'}`}>
                    {dayTime(e.at)}
                    {e.note ? ` · ${e.note}` : ''}
                  </span>
                </span>
                {voided ? (
                  <span className="shrink-0 text-xs text-[#888]">Đã hủy</span>
                ) : (
                  <button type="button" className={btn('outline', 'min-h-[34px] shrink-0 rounded-[10px] px-3 text-[13px]')} onClick={() => onVoid(e)} data-testid="payroll-entry-void">
                    Hủy
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
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
 * Lịch tháng (Figma R30 "Lịch làm việc"): ngày có mở ca tô xanh (kèm tổng giờ), ca đang mở tô cam, hôm nay viền cam;
 * ngày chủ đánh "có làm" viền đứt (+1 công), đánh nghỉ tô vàng. Bấm một ngày để xem ca của ngày đó, hoặc đánh / đổi / bỏ đánh dấu.
 */
function WorkCalendar({
  data,
  staffId,
  ym,
  p,
  birthday,
  picked,
  onPick,
  onChanged,
}: {
  data: PayrollMonth;
  staffId: string;
  ym: string;
  p: Payslip;
  birthday: string | null;
  picked: string | null;
  onPick: (d: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const today = businessDate(new Date());
  const weeks = monthGrid(ym);
  const work = workDays(data.shifts);
  const marks = new Map(data.marks.map((m) => [m.day, m]));
  const offCount = data.marks.filter((m) => m.kind === 'off').length;
  const extraCount = data.marks.filter((m) => m.kind === 'work' && !work.has(m.day)).length;
  // Ngày đã qua không có ca, cũng không đánh "có làm".
  const idle = weeks.flat().filter((d): d is string => !!d && d <= today && !work.has(d) && marks.get(d)?.kind !== 'work').length;
  const adj = p.days - p.shiftDays - p.markedDays;
  // Sinh nhật rơi vào tháng đang xem (29/2 ở năm không nhuận thì không có ô ⇒ bỏ).
  const bdayCell = birthday && birthday.slice(5, 7) === ym.slice(5) ? `${ym}-${birthday.slice(8)}` : null;
  const bday = bdayCell && weeks.flat().includes(bdayCell) ? bdayCell : null;
  const pickedHasShifts = !!picked && data.shifts.some((s) => businessDate(s.opened_at) === picked);

  const summary = [`Có ca ${p.shiftDays} ngày`];
  if (p.markedDays > 0) summary.push(`đánh có làm ${p.markedDays} ngày`);
  if (adj !== 0) summary.push(`chủ chỉnh ${adj > 0 ? '+' : ''}${adj}`);
  if (p.markedDays > 0 || adj !== 0) summary.push(`⇒ ${p.days} ngày công`);
  if (offCount > 0) summary.push(`đánh nghỉ ${offCount} ngày`);
  if (idle > 0) summary.push(`không có ca ${idle} ngày`);

  return (
    <Section
      title="Lịch làm việc"
      subtitle={
        <span data-testid="payroll-calendar-summary">
          {summary.join(' · ')}
          {ym === today.slice(0, 7) && ' (tới hôm nay)'}. Bấm ngày để xem ca / đánh nghỉ, có làm.
        </span>
      }
    >
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`Lịch ${monthLabel(ym).toLowerCase()}`} data-testid="payroll-calendar">
        {WEEKDAYS.map((w) => (
          <span key={w} role="columnheader" className="text-[11px] font-semibold leading-[14px] text-[#888]">
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
          const isToday = d === today;
          const tone = selected
            ? 'bg-brand text-white'
            : w?.open
              ? 'bg-[#ffeee7] text-[#c2380a]'
              : w
                ? 'bg-[#e8f7ee] text-[#15803d] hover:bg-[#d5f0df]'
                : extra
                  ? 'border border-dashed border-[#16a34a] bg-[#e8f7ee]/60 text-[#15803d]'
                  : o
                    ? 'bg-[#fef5e1] text-[#a16207] hover:bg-[#fcebc5]'
                    : isBday
                      ? 'text-[#b91c1c] hover:bg-[#f8f8f8]'
                      : future
                        ? 'text-[#bdbdbd] hover:bg-[#f8f8f8]'
                        : 'text-[#111] hover:bg-[#f8f8f8]';
          const label = [
            formatDate(d),
            w ? `${w.shifts} ca, ${formatMinutes(w.minutes)}${w.open ? ', đang mở' : ''}` : '',
            mk ? `đánh ${mk.kind === 'off' ? 'nghỉ' : 'có làm'}${mk.reason ? `: ${mk.reason}` : ''}` : '',
            isBday ? 'sinh nhật' : '',
          ]
            .filter(Boolean)
            .join(', ');
          const sub = w ? (w.open ? 'mở' : `${shortHours(w.minutes)}${w.shifts > 1 ? ` · ${w.shifts}` : ''}`) : mk ? (mk.kind === 'off' ? 'nghỉ' : 'làm') : null;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              aria-label={label}
              aria-selected={selected}
              title={mk?.reason ?? undefined}
              onClick={() => onPick(selected ? null : d)}
              className={`relative flex h-11 flex-col items-center justify-center rounded-[10px] transition-colors duration-fast ${tone} ${
                isToday && !selected ? 'outline outline-[1.5px] -outline-offset-[1.5px] outline-brand' : ''
              }`}
              data-testid={`payroll-day-${d}`}
              data-worked={w ? true : undefined}
              data-mark={mk?.kind}
            >
              <span className={`num text-[13px] leading-4 ${w || mk || isToday ? 'font-bold' : 'font-medium'}`}>{Number(d.slice(8))}</span>
              {sub && <span className={`num whitespace-nowrap text-[9px] font-semibold leading-[11px] ${selected ? 'text-white/90' : ''}`}>{sub}</span>}
              {w && mk && <span aria-hidden className={`absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full ${mk.kind === 'off' ? 'bg-[#eab308]' : 'bg-[#16a34a]'}`} />}
              {isBday && <Cake aria-hidden className={`absolute right-0.5 top-0.5 h-3 w-3 ${selected ? 'text-white' : 'text-[#b91c1c]'}`} />}
            </button>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-[14px] text-[#6d6d6d]">
        <Legend swatch="bg-[#e8f7ee]">Có mở ca</Legend>
        <Legend swatch="bg-[#ffeee7]">Đang mở</Legend>
        <Legend swatch="border border-brand bg-white">Hôm nay</Legend>
        {extraCount > 0 && <Legend swatch="border border-dashed border-[#16a34a] bg-[#e8f7ee]/60">Đánh có làm (+1 công)</Legend>}
        {offCount > 0 && <Legend swatch="bg-[#fef5e1]">Đánh nghỉ</Legend>}
        {bday && (
          <span className="flex items-center gap-1.5">
            <Cake aria-hidden className="h-3 w-3 text-[#b91c1c]" /> Sinh nhật
          </span>
        )}
      </p>
      {picked && <DayMarkForm key={`${picked}:${marks.get(picked)?.id ?? ''}`} staffId={staffId} day={picked} mark={marks.get(picked) ?? null} hasShifts={pickedHasShifts} onSaved={onChanged} />}
    </Section>
  );
}

function Legend({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-[3px] ${swatch}`} />
      {children}
    </span>
  );
}

/** Thẻ "Các ca trong tháng (n)" — hoặc các ca của ngày đang chọn trên lịch. */
function MonthShifts({ data, picked, onClear }: { data: PayrollMonth; picked: string | null; onClear: () => void }) {
  const shifts = picked ? data.shifts.filter((s) => businessDate(s.opened_at) === picked) : data.shifts;
  return (
    <Section
      title={<span data-testid="payroll-day-title">{picked ? `${weekdayName(picked)}, ${formatDate(picked)}` : `Các ca trong tháng (${data.shifts.length})`}</span>}
      right={
        picked && (
          <button type="button" className="shrink-0 text-[13px] font-semibold leading-5 text-brand hover:underline" onClick={onClear} data-testid="payroll-day-clear">
            Xem cả tháng
          </button>
        )
      }
    >
      {shifts.length === 0 && <p className="rounded-xl bg-[#f8f8f8] px-3 py-3 text-center text-[13px] text-[#888]">Không có ca nào.</p>}
      {shifts.length > 0 && (
        <ul className="flex flex-col gap-3.5" data-testid="payroll-shifts">
          {shifts.map((s) => (
            <li key={s.id}>
              <Link to={`/owner/shifts/${s.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-[#f8f8f8] px-3 py-2.5 transition-colors duration-fast hover:bg-[#efefef]">
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="num text-[13px] font-semibold leading-4">
                    {formatDate(businessDate(s.opened_at)).slice(0, 5)} · {hhmm(s.opened_at)} – {s.closed_at ? hhmm(s.closed_at) : '…'}
                  </span>
                  <span className="truncate text-xs leading-[15px] text-[#888]">{s.tablet_name}</span>
                </span>
                {s.closed_at ? (
                  <span className="num shrink-0 text-[13px] font-semibold leading-4 text-[#6d6d6d]">{formatMinutes(Math.round(minutesBetween(s.opened_at, s.closed_at)))}</span>
                ) : (
                  <Chip className={TONE.green}>
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
                    đang mở
                  </Chip>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
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
function DayMarkForm({ staffId, day, mark, hasShifts, onSaved }: { staffId: string; day: string; mark: DayMark | null; hasShifts: boolean; onSaved: () => Promise<void> }) {
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
  const tone = mark?.kind === 'work' ? 'bg-[#e8f7ee]/60' : mark ? 'bg-[#fef5e1]/70' : 'bg-[#f8f8f8]';
  return (
    <form className={`flex flex-col gap-3 rounded-xl p-3 ${tone}`} onSubmit={submit} data-testid="payroll-daymark">
      {mark ? (
        <p className={`text-sm font-semibold leading-[18px] ${mark.kind === 'work' ? 'text-[#15803d]' : 'text-[#a16207]'}`} data-testid="payroll-daymark-status">
          Đã đánh {mark.kind === 'work' ? 'có làm' : 'nghỉ'} {dd}
          {mark.reason ? ` · ${mark.reason}` : ''}
          {hasShifts && <span className="block text-xs font-normal leading-[15px] text-[#6d6d6d]">Ngày này có mở ca nên đã tính 1 ngày công theo ca.</span>}
        </p>
      ) : (
        <p className="text-xs leading-[17px] text-[#6d6d6d]">
          <b className="text-[13px] text-[#111]">
            {weekdayName(day)} {dd}: không có ca.
          </b>{' '}
          Đánh nghỉ để ghi nhận, hoặc đánh có làm nếu làm mà không mở ca (+1 ngày công).
        </p>
      )}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Loại">
        {MARK_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            className={`h-10 rounded-xl text-[13px] leading-4 transition-colors duration-fast ${
              kind === k ? 'border-[1.5px] border-brand bg-[#ffeee7] font-semibold text-[#c2380a]' : 'border border-line bg-white font-medium text-[#111] hover:bg-[#f8f8f8]'
            }`}
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
            className={pill(reason.trim() === c).replace('h-[34px]', 'h-[30px]')}
            aria-pressed={reason.trim() === c}
            onClick={() => setReason(reason.trim() === c ? '' : c)}
            data-testid="payroll-daymark-chip"
          >
            {c}
          </button>
        ))}
      </div>
      <Field label={kind === 'off' ? 'Lý do (không bắt buộc)' : 'Ghi chú (không bắt buộc)'}>
        <input value={reason} maxLength={DAY_MARK_REASON_MAX} onChange={(e) => setReason(e.target.value)} className={INPUT} data-testid="payroll-daymark-reason" />
      </Field>
      <ErrorText testId="payroll-daymark-error">{error}</ErrorText>
      <div className="grid grid-flow-col auto-cols-fr gap-2">
        <button type="submit" className={btn('brand', 'min-h-[42px]')} disabled={busy || !changed} data-testid="payroll-daymark-save">
          {mark ? 'Lưu' : kind === 'off' ? `Đánh nghỉ ${dd}` : `Đánh có làm ${dd}`}
        </button>
        {mark && (
          <button type="button" className={btn('outline', 'min-h-[42px]')} disabled={busy} onClick={() => void run(() => removeDayMark(client, mark.id))} data-testid="payroll-daymark-remove">
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

/** Dòng nhãn xám ↔ giá trị đậm của "Bảng lương" (cao 34). */
function Row({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-2.5 py-2 text-sm leading-[18px]">
      <span className="text-[#6d6d6d]">{label}</span>
      <span className="num text-right font-semibold" data-testid={testId}>
        {children}
      </span>
    </p>
  );
}
