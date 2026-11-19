import type { SupabaseClient } from '@supabase/supabase-js';
import type { Customer, Money } from '@/domain/types';

/** Sổ nợ (mục 7, màn chủ số 5): khách, dư nợ, lịch sử; chuyển khoản nợ sang khách khác; ghi thu nợ. */

export class DebtsError extends Error {}

export interface DebtRow {
  customer: Customer;
  balance: Money;
}

export interface DebtOrderRow {
  id: string;
  code: string;
  total: Money;
  paid_at: string;
  tablet_name: string;
  staff_name: string;
}

export interface DebtPaymentRow {
  id: string;
  amount: Money;
  method: 'cash' | 'transfer';
  at: string;
  /** Nhân viên thu trên tablet, hoặc "Chủ" khi chủ ghi thu. */
  by: string;
}

export interface CustomerDebt {
  customer: Customer;
  balance: Money;
  orders: DebtOrderRow[];
  payments: DebtPaymentRow[];
}

const CUSTOMER_COLUMNS = 'id,name,description,phone,address,merged_into_id';

function fail(what: string, error: { message: string }): never {
  throw new DebtsError(`Không tải được ${what}: ${error.message}`);
}

async function balances(client: SupabaseClient): Promise<Map<string, Money>> {
  const { data, error } = await client.rpc('customer_balances');
  if (error) fail('dư nợ', error);
  return new Map(((data ?? []) as Array<{ customer_id: string; balance: number }>).map((r) => [r.customer_id, r.balance]));
}

/** Khách gốc (chưa bị gộp), đang nợ nhiều nhất ở trên. */
export async function listDebts(client: SupabaseClient): Promise<DebtRow[]> {
  const [{ data, error }, bal] = await Promise.all([
    client.from('customers').select(CUSTOMER_COLUMNS).is('merged_into_id', null),
    balances(client),
  ]);
  if (error) fail('khách', error);
  return ((data ?? []) as Customer[])
    .map((customer) => ({ customer, balance: bal.get(customer.id) ?? 0 }))
    .sort((a, b) => b.balance - a.balance || a.customer.name.localeCompare(b.customer.name, 'vi'));
}

type RawOrder = { id: string; code: string; total: number; paid_at: string; tablet_profiles: { name: string } | null; shift: { staff: { name: string } | null } | null };
type RawPayment = { id: string; amount: number; method: 'cash' | 'transfer'; at: string; shifts: { staff: { name: string } | null } | null };

export async function loadCustomerDebt(client: SupabaseClient, customerId: string): Promise<CustomerDebt | null> {
  const [cRes, oRes, pRes, bal] = await Promise.all([
    client.from('customers').select(CUSTOMER_COLUMNS).eq('id', customerId),
    client
      .from('orders')
      .select('id,code,total,paid_at,tablet_profiles(name),shift:shifts!orders_paid_shift_id_fkey(staff(name))')
      .eq('customer_id', customerId)
      .eq('status', 'paid')
      .eq('payment_method', 'debt')
      .order('paid_at'),
    client.from('debt_payments').select('id,amount,method,at,shifts(staff(name))').eq('customer_id', customerId).order('at'),
    balances(client),
  ]);
  if (cRes.error) fail('khách', cRes.error);
  const customer = (cRes.data as Customer[] | null)?.[0];
  if (!customer) return null;
  if (oRes.error) fail('đơn ghi nợ', oRes.error);
  if (pRes.error) fail('lịch sử trả nợ', pRes.error);
  return {
    customer,
    balance: bal.get(customer.id) ?? 0,
    orders: ((oRes.data ?? []) as unknown as RawOrder[]).map((o) => ({
      id: o.id,
      code: o.code,
      total: o.total,
      paid_at: o.paid_at,
      tablet_name: o.tablet_profiles?.name ?? '',
      staff_name: o.shift?.staff?.name ?? '',
    })),
    payments: ((pRes.data ?? []) as unknown as RawPayment[]).map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      at: p.at,
      by: p.shifts?.staff?.name ?? 'Chủ',
    })),
  };
}

/** Chuyển các khoản nợ (đơn ghi nợ) sang khách khác. Tổng nợ toàn hệ thống không đổi; có nhật ký trước/sau. */
export async function transferDebt(client: SupabaseClient, orderIds: string[], toCustomerId: string): Promise<void> {
  if (orderIds.length === 0) throw new DebtsError('Chọn ít nhất một khoản nợ');
  const { error } = await client.rpc('owner_transfer_debt', { p_order_ids: orderIds, p_to: toCustomerId });
  if (error) throw new DebtsError(`Không chuyển được: ${error.message}`);
}

/** Chủ ghi thu nợ (không thuộc ca nào: không tính vào két ca). */
export async function recordOwnerDebtPayment(client: SupabaseClient, customerId: string, amount: Money, method: 'cash' | 'transfer'): Promise<void> {
  const { error } = await client.rpc('owner_record_debt_payment', { p_customer: customerId, p_amount: amount, p_method: method });
  if (error) throw new DebtsError(`Không ghi được: ${error.message}`);
}
