import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { parseMoneyInput } from '@/domain/catalog';
import { customerLabel, debtPaymentProblem, suggestCustomers } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import { hhmm } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { NavItem, NavList, OwnerLayout } from '../OwnerLayout';
import { listDebts, loadCustomerDebt, recordOwnerDebtPayment, transferDebt, type CustomerDebt, type DebtRow } from './api';

/** `/owner/debts/*` (mục 7, màn chủ số 5). */
export function DebtRoutes() {
  return (
    <Routes>
      <Route index element={<DebtList />} />
      <Route path=":customerId" element={<CustomerPage />} />
    </Routes>
  );
}

const day = (at: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date(at)) + ' ' + hhmm(at);

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

function DebtList() {
  const { client } = useOwner();
  const { data: rows, error } = useLoad(useCallback(() => listDebts(client), [client]));
  const total = rows?.reduce((s, r) => s + r.balance, 0) ?? 0;
  const owing = rows?.filter((r) => r.balance !== 0) ?? [];
  const clear = rows?.filter((r) => r.balance === 0) ?? [];

  return (
    <OwnerLayout title="Sổ nợ" back="/owner" testId="debt-list">
      <ErrorText testId="debt-error">{error}</ErrorText>
      {!rows && !error && <Splash />}
      {rows && (
        <>
          <p className="card flex items-baseline justify-between p-4">
            <span className="text-ink-muted">Tổng đang nợ</span>
            <b className="text-2xl" data-testid="debt-total">
              {formatVnd(total)}
            </b>
          </p>
          {owing.length === 0 && <p className="text-ink-subtle">Không ai đang nợ.</p>}
          {owing.length > 0 && <CustomerNav rows={owing} />}
          {clear.length > 0 && (
            <>
              <h2 className="mt-2 text-lg font-semibold text-ink-subtle">Đã trả hết</h2>
              <CustomerNav rows={clear} />
            </>
          )}
        </>
      )}
    </OwnerLayout>
  );
}

function CustomerNav({ rows }: { rows: DebtRow[] }) {
  return (
    <NavList>
      {rows.map((r) => (
        <NavItem
          key={r.customer.id}
          to={`/owner/debts/${r.customer.id}`}
          testId={`debt-row-${r.customer.id}`}
          title={`${customerLabel(r.customer)} · ${formatVnd(r.balance)}`}
          subtitle={r.customer.phone ?? undefined}
        />
      ))}
    </NavList>
  );
}

function CustomerPage() {
  const { customerId = '' } = useParams();
  const { client } = useOwner();
  const { data, error, reload } = useLoad(useCallback(() => loadCustomerDebt(client, customerId), [client, customerId]));
  return (
    <OwnerLayout title={data ? customerLabel(data.customer) : 'Khách nợ'} back="/owner/debts" testId="debt-customer">
      <ErrorText testId="debt-error">{error}</ErrorText>
      {data === undefined && !error && <Splash />}
      {data === null && <p className="text-ink-subtle">Không có khách này.</p>}
      {data && <CustomerBody d={data} onChanged={reload} />}
    </OwnerLayout>
  );
}

function CustomerBody({ d, onChanged }: { d: CustomerDebt; onChanged: () => Promise<void> }) {
  const [picked, setPicked] = useState<string[]>([]);
  // Khoản nợ đã chuyển đi thì bỏ chọn.
  useEffect(() => setPicked((p) => p.filter((id) => d.orders.some((o) => o.id === id))), [d]);
  const history = [
    ...d.orders.map((o) => ({ at: o.paid_at, key: o.id, kind: 'order' as const, o })),
    ...d.payments.map((p) => ({ at: p.at, key: p.id, kind: 'payment' as const, p })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="flex flex-col gap-4">
      <p className="card flex items-baseline justify-between p-4">
        <span className="text-ink-muted">Dư nợ</span>
        <b className="text-3xl" data-testid="debt-balance">
          {formatVnd(d.balance)}
        </b>
      </p>
      {d.customer.phone && <p className="text-ink-muted">SĐT: {d.customer.phone}</p>}

      <Card title="Lịch sử">
        {history.length === 0 && <p className="text-ink-subtle">Chưa có.</p>}
        {history.map((h) =>
          h.kind === 'order' ? (
            <label key={h.key} className="flex items-center gap-3 border-t border-line py-2" data-testid={`debt-order-${h.o.id}`}>
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={picked.includes(h.o.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, h.o.id] : p.filter((x) => x !== h.o.id)))}
                data-testid={`debt-pick-${h.o.id}`}
              />
              <span className="flex-1">
                {day(h.o.paid_at)} · Ghi nợ <b>đơn #<span className="font-mono">{h.o.code}</span></b>
                <span className="block text-sm text-ink-subtle">
                  {h.o.staff_name} – {h.o.tablet_name}
                </span>
              </span>
              <b>+{formatVnd(h.o.total)}</b>
            </label>
          ) : (
            <p key={h.key} className="flex items-center justify-between gap-3 border-t border-line py-2" data-testid="debt-payment-row">
              <span>
                {day(h.p.at)} · Trả nợ ({h.p.method === 'cash' ? 'TM' : 'CK'})
                <span className="block text-sm text-ink-subtle">{h.p.by}</span>
              </span>
              <b className="text-success-strong">−{formatVnd(h.p.amount)}</b>
            </p>
          ),
        )}
      </Card>

      {d.orders.length > 0 && <TransferForm d={d} picked={picked} onDone={onChanged} />}
      {d.balance > 0 && <PaymentForm d={d} onDone={onChanged} />}
    </div>
  );
}

/** Chuyển khoản nợ: chọn đơn ghi nợ ở trên → tìm khách nhận → Chuyển. */
function TransferForm({ d, picked, onDone }: { d: CustomerDebt; picked: string[]; onDone: () => Promise<void> }) {
  const { client } = useOwner();
  const [others, setOthers] = useState<DebtRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<DebtRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listDebts(client)
      .then((r) => alive && setOthers(r.filter((x) => x.customer.id !== d.customer.id)))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client, d]);

  const amount = d.orders.filter((o) => picked.includes(o.id)).reduce((s, o) => s + o.total, 0);
  const matches = others && query.trim() ? suggestCustomers(others.map((r) => r.customer), query) : [];

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await transferDebt(client, picked, target.customer.id);
      setDone(`Đã chuyển ${formatVnd(amount)} sang ${customerLabel(target.customer)}`);
      setTarget(null);
      setQuery('');
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Chuyển nợ sang khách khác">
      <p className="text-sm text-ink-subtle">Đánh dấu các đơn ghi nợ ở trên, rồi chọn khách nhận.</p>
      {done && (
        <p className="rounded-lg bg-success-soft px-3 py-2 text-success-strong" data-testid="transfer-done">
          {done}
        </p>
      )}
      {target ? (
        <p className="flex items-center justify-between gap-2 rounded-lg bg-warning-soft p-3" data-testid="transfer-target">
          <span>
            Sang <b>{customerLabel(target.customer)}</b> (đang nợ {formatVnd(target.balance)})
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => setTarget(null)}>
            Đổi
          </button>
        </p>
      ) : (
        <>
          <TextField label="Khách nhận" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="transfer-search" />
          {matches.map((c) => {
            const row = others!.find((r) => r.customer.id === c.id)!;
            return (
              <button
                key={c.id}
                type="button"
                className="btn flex items-center justify-between btn-secondary text-left"
                onClick={() => setTarget(row)}
                data-testid={`transfer-to-${c.id}`}
              >
                <span>{customerLabel(c)}</span>
                <span className="text-sm font-normal text-ink-subtle">nợ {formatVnd(row.balance)}</span>
              </button>
            );
          })}
        </>
      )}
      <ErrorText testId="transfer-error">{error}</ErrorText>
      <button type="button" className="btn btn-primary" disabled={busy || !target || picked.length === 0} onClick={() => void submit()} data-testid="transfer-submit">
        {picked.length ? `Chuyển ${picked.length} khoản · ${formatVnd(amount)}` : 'Chưa chọn khoản nợ'}
      </button>
    </Card>
  );
}

function PaymentForm({ d, onDone }: { d: CustomerDebt; onDone: () => Promise<void> }) {
  const { client } = useOwner();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'transfer'>('transfer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseMoneyInput(amount);

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
    <Card title="Ghi thu nợ (chủ thu)">
      <p className="text-sm text-ink-subtle">Khoản chủ tự thu, không tính vào két ca nào.</p>
      <form className="flex flex-col gap-3" onSubmit={submit} data-testid="owner-debt-form">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Hình thức">
          {(['transfer', 'cash'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
              className="btn btn-segment"
              data-testid={`owner-debt-method-${m}`}
            >
              {m === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}
            </button>
          ))}
        </div>
        <TextField label="Số tiền" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="owner-debt-amount" />
        <ErrorText testId="owner-debt-error">{error}</ErrorText>
        <button type="submit" className="btn btn-success" disabled={busy} data-testid="owner-debt-submit">
          {parsed ? `Ghi thu ${formatVnd(parsed)}` : 'Ghi thu'}
        </button>
      </form>
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
