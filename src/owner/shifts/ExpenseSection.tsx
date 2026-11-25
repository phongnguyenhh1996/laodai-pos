import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert, Pencil, Plus, X } from 'lucide-react';
import { ErrorText, errorMessage } from '@/app/ui';
import { MoneyInput } from '@/app/MoneyInput';
import { activeExpenseTotal, cleanExpenseNote, validateExpense } from '@/domain/expenses';
import { formatVnd } from '@/domain/money';
import { hhmm } from '@/domain/time';
import type { Money, ShiftExpense } from '@/domain/types';
import { useOwner } from '../OwnerContext';
import { Section, TONE } from '../ui';
import { createExpense, editExpense, recentExpenseNotes, voidExpense } from './api';

const PROBLEM: Record<string, string> = {
  bad_expense_amount: 'Số tiền phải lớn hơn 0',
  bad_expense_note: 'Cần ghi chú (tối đa 80 ký tự)',
};
const field = 'h-[45px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] leading-[19px] outline-none placeholder:text-[#a3a3a3] focus:border-brand';

/**
 * Khối "Khoản chi" ở chi tiết ca (SPEC 4.9, Figma E8 / E9): mọi khoản của ca (cả khoản đã hủy, gạch ngang),
 * chủ ghi thêm / sửa / hủy được kể cả khi ca đã đóng (server tính lại đối soát, "đã điều chỉnh").
 */
export function ExpenseSection({ shiftId, closed, expenses, staffName, onChanged }: { shiftId: string; closed: boolean; expenses: ShiftExpense[]; staffName: string; onChanged: () => Promise<void> }) {
  const { client } = useOwner();
  const [editing, setEditing] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const live = expenses.filter((e) => e.voided_at === null);
  const voided = expenses.length - live.length;

  useEffect(() => {
    let alive = true;
    void recentExpenseNotes(client).then((n) => alive && setRecent(n));
    return () => {
      alive = false;
    };
  }, [client]);

  const subtitle =
    expenses.length === 0 ? 'Chưa có khoản chi nào' : `${live.length} khoản · ${formatVnd(activeExpenseTotal(expenses))}${voided ? ` · ${voided} đã hủy` : ''}`;

  return (
    <Section title="Khoản chi" subtitle={subtitle} testId="shift-expenses">
      {expenses.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {expenses.map((e) =>
            editing === e.id ? (
              <EditRow key={e.id} e={e} closed={closed} onDone={async () => (setEditing(null), await onChanged())} onCancel={() => setEditing(null)} />
            ) : (
              <li
                key={e.id}
                data-testid="shift-expense-row"
                data-voided={e.voided_at ? 'true' : undefined}
                className={`num flex items-center gap-2 rounded-[10px] bg-[#f8f8f8] px-3 py-2 text-[13px] leading-4 ${e.voided_at ? 'text-[#a3a3a3]' : ''}`}
              >
                <b className={`font-semibold ${e.voided_at ? 'line-through' : 'text-[#b91c1c]'}`}>−{formatVnd(e.amount)}</b>
                <span className={`min-w-0 flex-1 truncate ${e.voided_at ? 'line-through' : 'text-[#888]'}`}>
                  {hhmm(e.at)} · {e.note} · {e.actor_kind === 'owner' ? 'Chủ ghi' : staffName}
                </span>
                {e.voided_at ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE.gray}`}>Đã hủy</span>
                ) : (
                  <button
                    type="button"
                    aria-label="Sửa khoản chi"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#6d6d6d] hover:text-[#111]"
                    onClick={() => setEditing(e.id)}
                    data-testid="shift-expense-edit"
                  >
                    <Pencil aria-hidden className="h-4 w-4" />
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      <CreateForm shiftId={shiftId} recent={recent} hasRows={expenses.length > 0} onSaved={onChanged} />
    </Section>
  );
}

function CreateForm({ shiftId, recent, hasRows, onSaved }: { shiftId: string; recent: string[]; hasRows: boolean; onSaved: () => Promise<void> }) {
  const { client } = useOwner();
  const [amount, setAmount] = useState<Money | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const problem = validateExpense(amount, note);
    if (problem) return setError(PROBLEM[problem]);
    setBusy(true);
    setError(null);
    try {
      await createExpense(client, shiftId, amount!, cleanExpenseNote(note));
      setAmount(null);
      setNote('');
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`flex flex-col gap-3.5 ${hasRows ? 'border-t border-line pt-3.5' : ''}`} onSubmit={submit} data-testid="shift-expense-form">
      <div className="grid grid-cols-2 gap-2.5">
        <MoneyInput size="owner" label="Số tiền" value={amount} onChange={setAmount} testId="shift-expense-amount" />
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] font-medium leading-4 text-[#6d6d6d]">Ghi chú</span>
          <input className={field} placeholder="VD: mua đá" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} data-testid="shift-expense-note" />
        </label>
      </div>
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recent.slice(0, 5).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNote(n)}
              className={`h-8 rounded-full border px-3 text-[13px] font-medium ${n === cleanExpenseNote(note) ? 'border-brand bg-[#ffeee7] text-[#c2380a]' : 'border-line bg-white text-[#6d6d6d]'}`}
              data-testid="shift-expense-recent"
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <ErrorText testId="shift-expense-error">{error}</ErrorText>
      <button
        type="submit"
        className="inline-flex h-[45px] items-center justify-center gap-2 rounded-xl bg-[#ffeee7] text-[15px] font-semibold leading-[19px] text-[#c2380a] hover:bg-[#ffe2d5] disabled:opacity-40"
        disabled={busy}
        data-testid="shift-expense-submit"
      >
        <Plus aria-hidden className="h-[17px] w-[17px]" />
        {amount ? `Ghi khoản chi ${formatVnd(amount)}` : 'Ghi khoản chi'}
      </button>
    </form>
  );
}

function EditRow({ e, closed, onDone, onCancel }: { e: ShiftExpense; closed: boolean; onDone: () => Promise<void>; onCancel: () => void }) {
  const { client } = useOwner();
  const [amount, setAmount] = useState<Money | null>(e.amount);
  const [note, setNote] = useState(e.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function save() {
    const problem = validateExpense(amount, note);
    if (problem) return setError(PROBLEM[problem]);
    void run(() => editExpense(client, e.id, amount!, cleanExpenseNote(note)));
  }

  return (
    <li className="flex flex-col gap-2.5 rounded-[10px] border border-brand bg-white p-3" data-testid="shift-expense-editing">
      <div className="grid grid-cols-2 gap-2.5">
        <MoneyInput size="owner" label="Số tiền" value={amount} onChange={setAmount} testId="shift-expense-edit-amount" />
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] font-medium leading-4 text-[#6d6d6d]">Ghi chú</span>
          <input className={field} maxLength={80} value={note} onChange={(ev) => setNote(ev.target.value)} data-testid="shift-expense-edit-note" />
        </label>
      </div>
      <ErrorText testId="shift-expense-edit-error">{error}</ErrorText>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <button type="button" className="inline-flex h-[40px] items-center justify-center rounded-xl bg-[#111] text-sm font-semibold text-white disabled:opacity-40" disabled={busy} onClick={save} data-testid="shift-expense-save">
          Lưu
        </button>
        <button type="button" className="inline-flex h-[40px] items-center justify-center rounded-xl border border-line bg-white text-sm font-semibold" onClick={onCancel} data-testid="shift-expense-cancel">
          Thôi
        </button>
        <button
          type="button"
          className="inline-flex h-[40px] items-center justify-center gap-1.5 rounded-xl bg-[#fdecec] px-3 text-sm font-semibold text-[#b91c1c] disabled:opacity-40"
          disabled={busy}
          onClick={() => void run(() => voidExpense(client, e.id))}
          data-testid="shift-expense-void"
        >
          <X aria-hidden className="h-4 w-4" />
          Hủy khoản
        </button>
      </div>
      {closed && (
        <p className="flex items-center gap-2 text-xs text-[#a16207]">
          <CircleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Ca đã đóng: lưu sẽ tính lại đối soát (đã điều chỉnh).
        </p>
      )}
    </li>
  );
}
