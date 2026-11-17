import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReconcileResult } from '@/domain/reconcile';
import type { Money } from '@/domain/types';
import type { Revenue } from '../dashboard/api';

/** Báo cáo (mục 7, màn chủ số 4): RPC `owner_report(from, to)`, khoảng ngày theo giờ VN. */

export class ReportError extends Error {}

export interface Report {
  range: { from: string; to: string; from_date: string; to_date: string };
  revenue: Revenue;
  by_day_point: Array<Revenue & { date: string; point_id: string; point_name: string }>;
  /** Tổng CK theo ngày / điểm + thu nợ bằng CK: để chủ so với app ngân hàng. */
  bank_check: Array<{
    date: string;
    points: Array<{ point_id: string; point_name: string; amount: Money; orders: number }>;
    debt_payments: { amount: Money; count: number };
    total: Money;
  }>;
  by_staff: Array<{
    staff_id: string;
    staff_name: string;
    total: Money;
    cash: Money;
    transfer: Money;
    debt: Money;
    orders: number;
    debt_collected: Money;
    edits: number;
    deletes: number;
  }>;
  by_shift: Array<{
    shift_id: string;
    staff_name: string;
    tablet_name: string;
    opened_at: string;
    closed_at: string | null;
    status: 'open' | 'closed';
    recalculated_at: string | null;
    reconcile: ReconcileResult;
  }>;
  top_products: Array<{ product_id: string; name: string; qty: number; revenue: Money }>;
}

export async function loadReport(client: SupabaseClient, from: string, to: string): Promise<Report> {
  const { data, error } = await client.rpc('owner_report', { p_from: from, p_to: to });
  if (error) throw new ReportError(`Không tải được báo cáo: ${error.message}`);
  return data as Report;
}
