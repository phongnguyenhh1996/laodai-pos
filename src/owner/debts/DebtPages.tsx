import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Banknote, Check, ChevronRight, HandCoins, Landmark, Plus, UserRound } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { parseMoneyInput } from '@/domain/catalog';
import { customerLabel, debtPaymentProblem, suggestCustomers } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import { shortDate } from '@/domain/report';
import { businessDate, dayTime } from '@/domain/time';
import type { Customer } from '@/domain/types';
import { useOwner } from '../OwnerContext';
import { Chip, OwnerLayout } from '../OwnerLayout';
import { IconTile, KV, PageHead, SearchBox, SelectBox, Section, TONE, btn, card } from '../ui';
import {
  listDebts,
  loadCustomerDebt,
  loadDebtSummary,
  recordOwnerDebtPayment,
  transferDebt,
  type CustomerDebt,
  type DebtRow,
  type DebtSummary,
} from './api';

/** `/owner/debts/*` (mục 7, màn chủ số 5). Figma R26/T27, R27/T28. */
export function DebtRoutes() {
  return (
    <Routes>
      <Route index element={<DebtList />} />
      <Route path=":customerId" element={<CustomerPage />} />
    </Routes>
  );
}

const ddmm = (at: string) => shortDate(businessDate(new Date(at)));
const initial = (name: string) => name.trim().charAt(0).toUpperCase();

/** "0903 ••• 812". */
function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length >= 7 ? `${d.slice(0, 4)} ••• ${d.slice(-3)}` : phone;
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
    void reload();
  }, [reload]);
  return { data, error, reload };
}

/** Thẻ vàng nhạt (Figma "Tổng nợ" / "Khách"). */
const AMBER_CARD = 'flex flex-col rounded-2xl border border-[#f6dfae] bg-[#fef5e1]';

function DebtList() {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const today = businessDate(new Date());
  const { data, error } = useLoad(
    useCallback(async () => {
      const [rows, summary] = await Promise.all([listDebts(client), loadDebtSummary(client, today)]);
      return { rows, summary };
    }, [client, today]),
  );
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const rows = data?.rows;
  const shown = rows && query.trim() ? filterRows(rows, query) : rows;
  const subtitle = 'Dư nợ · lịch sử · chuyển nợ · ghi thu nợ';

  function startPayment() {
    setPicking(true);
    searchRef.current?.focus();
  }

  const summary = data && <SummaryCard rows={data.rows} s={data.summary} />;
  const cta = rows && (
    <button
      type="button"
      className={btn('brand', 'min-h-[47px] rounded-[14px] text-[15px] leading-[19px]')}
      onClick={startPayment}
      disabled={!rows.some((r) => r.balance > 0)}
      data-testid="debt-collect"
    >
      <Plus aria-hidden className="h-[18px] w-[18px]" />
      Ghi thu nợ
    </button>
  );
  const search = rows && (
    <SearchBox value={query} onChange={setQuery} placeholder="Tìm tên hoặc số điện thoại…" testId="debt-search" inputRef={searchRef} />
  );
  const list = data && shown && (
    <>
      {picking && (
        <p className="text-[13px] font-medium leading-4 text-[#c2380a]" data-testid="debt-pick-hint">
          Chọn khách để ghi thu nợ
        </p>
      )}
      <DebtTable rows={shown} lastPaidAt={data.summary.lastPaidAt} collect={picking} empty={data.rows.length ? 'Không tìm thấy khách.' : 'Chưa có khách nợ.'} />
    </>
  );

  return (
    <OwnerLayout
      title={isTablet ? 'Sổ nợ khách' : 'Sổ nợ'}
      subtitle={isTablet ? subtitle : undefined}
      back={isTablet ? '/owner' : '/owner/more'}
      tabBar
      wide
      testId="debt-list"
    >
      {!isTablet && <PageHead title="Sổ nợ khách" subtitle={subtitle} />}
      <ErrorText testId="debt-error">{error}</ErrorText>
      {!data && !error && <Splash />}
      {data &&
        (isTablet ? (
          <div className="grid grid-cols-[minmax(0,338fr)_minmax(0,506fr)] items-start gap-5">
            <div className="flex flex-col gap-4">
              {summary}
              {cta}
            </div>
            <div className="flex flex-col gap-4">
              {search}
              {list}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {summary}
            {search}
            {list}
            {cta}
          </div>
        ))}
    </OwnerLayout>
  );
}

function filterRows(rows: DebtRow[], query: string): DebtRow[] {
  const hit = new Set(suggestCustomers(rows.map((r) => r.customer), query, rows.length).map((c) => c.id));
  return rows.filter((r) => hit.has(r.customer.id));
}

function SummaryCard({ rows, s }: { rows: DebtRow[]; s: DebtSummary }) {
  const total = rows.reduce((sum, r) => sum + r.balance, 0);
  const owing = rows.filter((r) => r.balance > 0).length;
  return (
    <section className={`${AMBER_CARD} gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium leading-[18px] text-[#a16207]">
          <IconTile icon={HandCoins} className="h-8 w-8 rounded-[10px]" iconClass="h-4 w-4" tone="bg-white text-[#a16207]" />
          Tổng dư nợ
        </span>
        <Chip className="bg-white text-[#a16207]">{owing} khách</Chip>
      </div>
      <b className="num text-[32px] leading-[38px] text-[#a16207]" data-testid="debt-total">
        {formatVnd(total)}
      </b>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Ghi nợ hôm nay" value={s.todayDebt} testId="debt-today-new" />
        <MiniStat label="Thu nợ hôm nay" value={s.todayPaid} testId="debt-today-paid" />
      </div>
    </section>
  );
}

function MiniStat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <p className="flex flex-col gap-0.5 rounded-[10px] bg-white px-2.5 py-2">
      <span className="text-[11px] leading-[14px] text-[#888]">{label}</span>
      <b className="num text-sm leading-[18px]" data-testid={testId}>
        {formatVnd(value)}
      </b>
    </p>
  );
}

function DebtTable({ rows, lastPaidAt, collect, empty }: { rows: DebtRow[]; lastPaidAt: Map<string, string>; collect: boolean; empty: string }) {
  return (
    <div className={`${card} overflow-hidden`}>
      <p className="flex items-center justify-between bg-[#f8f8f8] px-3.5 py-2.5 text-xs font-medium leading-[15px] text-[#6d6d6d]">
        <span>Khách</span>
        <span>Dư nợ</span>
      </p>
      {rows.length === 0 && <p className="px-3.5 py-5 text-center text-sm text-[#888]">{empty}</p>}
      {rows.map((r) => (
        <DebtTableRow key={r.customer.id} r={r} lastPaidAt={lastPaidAt.get(r.customer.id)} collect={collect} />
      ))}
    </div>
  );
}

function rowSubtitle(c: Customer, balance: number, lastPaidAt: string | undefined): string {
  // Khách đã trả hết vẫn giữ mô tả để phân biệt hai khách trùng tên.
  if (balance === 0) return [c.description, lastPaidAt ? `Đã trả hết · ${ddmm(lastPaidAt)}` : 'Đã trả hết'].filter(Boolean).join(' · ');
  return [c.description, c.phone && maskPhone(c.phone)].filter(Boolean).join(' · ');
}

function DebtTableRow({ r, lastPaidAt, collect }: { r: DebtRow; lastPaidAt?: string; collect: boolean }) {
  const sub = rowSubtitle(r.customer, r.balance, lastPaidAt);
  return (
    <Link
      to={`/owner/debts/${r.customer.id}${collect && r.balance > 0 ? '?thu=1' : ''}`}
      className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-3 transition-colors duration-fast first-of-type:border-t-0 hover:bg-[#fafafa]"
      data-testid={`debt-row-${r.customer.id}`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#fef5e1] text-[15px] font-bold text-[#a16207]">
          {initial(r.customer.name)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold leading-[19px]">{r.customer.name}</span>
          {sub && <span className="truncate text-xs leading-[15px] text-[#888]">{sub}</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <b className={`num text-[15px] leading-[19px] ${r.balance ? 'text-[#a16207]' : 'text-[#888]'}`}>{formatVnd(r.balance)}</b>
        <ChevronRight aria-hidden className="h-4 w-4 text-[#888]" />
      </span>
    </Link>
  );
}

function CustomerPage() {
  const { customerId = '' } = useParams();
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const { data, error, reload } = useLoad(useCallback(() => loadCustomerDebt(client, customerId), [client, customerId]));
  return (
    <OwnerLayout
      title={isTablet && data ? customerLabel(data.customer) : 'Sổ nợ'}
      subtitle={isTablet && data ? `Dư nợ ${formatVnd(data.balance)}` : undefined}
      back="/owner/debts"
      tabBar
      wide
      testId="debt-customer"
    >
      <ErrorText testId="debt-error">{error}</ErrorText>
      {data === undefined && !error && <Splash />}
      {data === null && <p className="text-sm text-[#888]">Không có khách này.</p>}
      {data && <CustomerBody d={data} onChanged={reload} />}
    </OwnerLayout>
  );
}

/** Các đơn ghi nợ còn chưa trả hết (tiền trả trừ vào đơn cũ nhất trước). */
function openOrders(d: CustomerDebt) {
  let paid = Math.max(0, d.orders.reduce((s, o) => s + o.total, 0) - d.balance);
  return [...d.orders]
    .sort((a, b) => a.paid_at.localeCompare(b.paid_at))
    .filter((o) => {
      const used = Math.min(paid, o.total);
      paid -= used;
      return o.total - used > 0;
    });
}

function CustomerBody({ d, onChanged }: { d: CustomerDebt; onChanged: () => Promise<void> }) {
  const isTablet = useIsTablet();
  const [picked, setPicked] = useState<string[]>([]);
  // Khoản nợ đã chuyển đi thì bỏ chọn.
  useEffect(() => setPicked((p) => p.filter((id) => d.orders.some((o) => o.id === id))), [d]);

  const head = <CustomerCard d={d} />;
  const history = <History d={d} picked={picked} setPicked={setPicked} />;
  const transfer = d.orders.length > 0 && <TransferForm d={d} picked={picked} onDone={onChanged} />;
  const payment = d.balance > 0 && <PaymentForm d={d} onDone={onChanged} />;

  return isTablet ? (
    <div className="grid grid-cols-2 items-start gap-5">
      <div className="flex flex-col gap-4">
        {head}
        {history}
      </div>
      <div className="flex flex-col gap-4">
        {transfer}
        {payment}
      </div>
    </div>
  ) : (
    <div className="flex flex-col gap-3.5">
      {head}
      {history}
      {transfer}
      {payment}
    </div>
  );
}

function CustomerCard({ d }: { d: CustomerDebt }) {
  const open = openOrders(d);
  const sub = open.length ? `${open.length} khoản nợ · từ ${ddmm(open[0].paid_at)}` : 'Đã trả hết';
  return (
    <section className={`${AMBER_CARD} gap-3.5 p-4`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-white text-lg font-bold text-[#a16207]">
          {initial(d.customer.name)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="truncate text-[17px] leading-[22px]">{customerLabel(d.customer)}</b>
          <span className="text-xs leading-[15px] text-[#a16207]">{sub}</span>
        </span>
      </div>
      <p className="flex min-h-[54px] items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2">
        <span className="text-sm leading-[18px] text-[#6d6d6d]">Dư nợ</span>
        <b className={`num text-2xl leading-[30px] ${d.balance ? 'text-[#a16207]' : 'text-[#888]'}`} data-testid="debt-balance">
          {formatVnd(d.balance)}
        </b>
      </p>
      {(d.customer.phone || d.customer.address) && (
        <div className="-my-1 flex flex-col">
          {d.customer.phone && <KV label="Số điện thoại">{d.customer.phone}</KV>}
          {d.customer.address && <KV label="Địa chỉ giao gần nhất">{d.customer.address}</KV>}
        </div>
      )}
    </section>
  );
}

function History({ d, picked, setPicked }: { d: CustomerDebt; picked: string[]; setPicked: (f: (p: string[]) => string[]) => void }) {
  const rows = [
    ...d.orders.map((o) => ({ at: o.paid_at, key: o.id, kind: 'order' as const, o })),
    ...d.payments.map((p) => ({ at: p.at, key: p.id, kind: 'payment' as const, p })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 p-3.5">
        <h2 className="text-base font-bold leading-5 tracking-normal">Lịch sử</h2>
        {d.orders.length > 0 && <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold leading-[14px] ${TONE.gray}`}>Chọn để chuyển nợ</span>}
      </div>
      {rows.length === 0 && <p className="border-t border-line px-3.5 py-4 text-sm text-[#888]">Chưa có.</p>}
      {rows.map((h) =>
        h.kind === 'order' ? (
          <label key={h.key} className="flex cursor-pointer items-start gap-3 border-t border-line px-3.5 py-3 hover:bg-[#fafafa]" data-testid={`debt-order-${h.o.id}`}>
            <span className="relative mt-px flex h-[22px] w-[22px] shrink-0">
              <input
                type="checkbox"
                className="peer h-[22px] w-[22px] cursor-pointer appearance-none rounded-[7px] border-[1.5px] border-[#d4d4d4] bg-white checked:border-brand checked:bg-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                checked={picked.includes(h.o.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, h.o.id] : p.filter((x) => x !== h.o.id)))}
                aria-label={`Chọn đơn #${h.o.code}`}
                data-testid={`debt-pick-${h.o.id}`}
              />
              <Check aria-hidden strokeWidth={3} className="pointer-events-none absolute left-1 top-1 hidden h-[14px] w-[14px] text-white peer-checked:block" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold leading-[18px]">
                  Ghi nợ · đơn #<span className="font-mono">{h.o.code}</span>
                </span>
                <b className="num shrink-0 text-sm leading-[18px] text-[#a16207]">+{formatVnd(h.o.total)}</b>
              </span>
              {h.o.items && (
                <span className="text-[13px] leading-4" data-testid={`debt-items-${h.o.id}`}>
                  {h.o.items}
                </span>
              )}
              <span className="text-xs leading-[15px] text-[#888]">
                {[dayTime(h.o.paid_at), [h.o.staff_name, h.o.tablet_name].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
              </span>
            </span>
          </label>
        ) : (
          <div key={h.key} className="flex items-start gap-3 border-t border-line px-3.5 py-3" data-testid="debt-payment-row">
            <IconTile icon={HandCoins} className="mt-px h-[22px] w-[22px] rounded-[7px]" iconClass="h-[13px] w-[13px]" tone={TONE.green} />
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold leading-[18px]">Trả nợ · {h.p.method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}</span>
                <b className="num shrink-0 text-sm leading-[18px] text-[#15803d]">−{formatVnd(h.p.amount)}</b>
              </span>
              <span className="text-xs leading-[15px] text-[#888]">
                {dayTime(h.p.at)} · {h.p.by}
              </span>
            </span>
          </div>
        ),
      )}
    </section>
  );
}

const BIG_BTN = 'min-h-[45px] text-[15px] leading-[19px]';

/** Chuyển khoản nợ: chọn đơn ghi nợ ở Lịch sử → chọn khách nhận → Chuyển. */
function TransferForm({ d, picked, onDone }: { d: CustomerDebt; picked: string[]; onDone: () => Promise<void> }) {
  const { client } = useOwner();
  const [others, setOthers] = useState<DebtRow[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listDebts(client)
      .then((r) => alive && setOthers(r.filter((x) => x.customer.id !== d.customer.id).sort((a, b) => a.customer.name.localeCompare(b.customer.name, 'vi'))))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client, d]);

  const target = others?.find((r) => r.customer.id === targetId) ?? null;
  const amount = d.orders.filter((o) => picked.includes(o.id)).reduce((s, o) => s + o.total, 0);

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await transferDebt(client, picked, target.customer.id);
      setDone(`Đã chuyển ${formatVnd(amount)} sang ${customerLabel(target.customer)}`);
      setTargetId('');
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Chuyển nợ sang khách khác"
      subtitle="Đánh dấu các đơn ghi nợ ở trên, rồi chọn khách nhận."
      right={<IconTile icon={ArrowLeftRight} className="h-[34px] w-[34px] rounded-[10px]" iconClass="h-[17px] w-[17px]" tone={TONE.blue} />}
    >
      {done && (
        <p className={`rounded-xl px-3.5 py-2.5 text-sm font-medium ${TONE.green}`} data-testid="transfer-done">
          {done}
        </p>
      )}
      <SelectBox icon={UserRound} value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label="Khách nhận" data-testid="transfer-select">
        <option value="">Chọn khách nhận…</option>
        {others?.map((r) => (
          <option key={r.customer.id} value={r.customer.id}>
            {customerLabel(r.customer)} · nợ {formatVnd(r.balance)}
          </option>
        ))}
      </SelectBox>
      <ErrorText testId="transfer-error">{error}</ErrorText>
      <button
        type="button"
        className={btn('dark', `${BIG_BTN} disabled:bg-[#efefef] disabled:text-[#a3a3a3] disabled:opacity-100`)}
        disabled={busy || !target || picked.length === 0}
        onClick={() => void submit()}
        data-testid="transfer-submit"
      >
        <ArrowLeftRight aria-hidden className="h-[17px] w-[17px]" />
        {picked.length ? `Chuyển ${formatVnd(amount)} sang ${target ? customerLabel(target.customer) : 'khách'}` : 'Chưa chọn khoản nợ'}
      </button>
    </Section>
  );
}

function PaymentForm({ d, onDone }: { d: CustomerDebt; onDone: () => Promise<void> }) {
  const { client } = useOwner();
  const [params] = useSearchParams();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'transfer'>('transfer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const parsed = parseMoneyInput(amount);

  // Từ nút "Ghi thu nợ" ở danh sách: cuộn tới và đặt con trỏ vào ô số tiền.
  const jump = params.get('thu') === '1';
  useEffect(() => {
    if (!jump) return;
    amountRef.current?.scrollIntoView({ block: 'center' });
    amountRef.current?.focus({ preventScroll: true });
  }, [jump]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = debtPaymentProblem(parsed, d.balance);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordOwnerDebtPayment(client, d.customer.id, parsed!, method);
      setAmount('');
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Ghi thu nợ (chủ thu)"
      subtitle="Khoản chủ tự thu, không tính vào két ca nào."
      right={<IconTile icon={HandCoins} className="h-[34px] w-[34px] rounded-[10px]" iconClass="h-[17px] w-[17px]" tone={TONE.green} />}
    >
      <form className="flex flex-col gap-3.5" onSubmit={submit} data-testid="owner-debt-form">
        <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Hình thức">
          {(['cash', 'transfer'] as const).map((m) => {
            const on = method === m;
            const Icon = m === 'cash' ? Banknote : Landmark;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => setMethod(m)}
                className={`flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-[14px] px-2 py-3.5 text-[13px] leading-4 transition-colors duration-fast ${
                  on ? 'border-[1.5px] border-brand bg-[#ffeee7] font-semibold text-[#c2380a]' : 'border border-line bg-white font-medium text-[#111] hover:bg-[#f8f8f8]'
                }`}
                data-testid={`owner-debt-method-${m}`}
              >
                <Icon aria-hidden className="h-[22px] w-[22px]" />
                {m === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium leading-4 text-[#6d6d6d]">Số tiền</span>
          <span className="flex h-[45px] items-center gap-2 rounded-xl border border-line bg-white px-3.5 focus-within:border-brand">
            <input
              ref={amountRef}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="num min-w-0 flex-1 bg-transparent text-[15px] font-medium leading-[19px] outline-none placeholder:text-[#a3a3a3] focus-visible:ring-0"
              data-testid="owner-debt-amount"
            />
            <span className="text-[13px] text-[#888]">đ</span>
          </span>
        </label>
        <ErrorText testId="owner-debt-error">{error}</ErrorText>
        <button type="submit" className={btn('brand', BIG_BTN)} disabled={busy} data-testid="owner-debt-submit">
          <Check aria-hidden className="h-[17px] w-[17px]" />
          {parsed ? `Ghi thu ${formatVnd(parsed)}` : 'Ghi thu'}
        </button>
      </form>
    </Section>
  );
}
