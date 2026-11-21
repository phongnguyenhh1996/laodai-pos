import type { SupabaseClient } from '@supabase/supabase-js';
import type { MethodSplit } from '@/domain/report';
import type { Money, OrderStatus } from '@/domain/types';

/** Tổng quan (mục 7, màn chủ số 1): số liệu hôm nay, tính ở server (RPC `owner_dashboard`). */

export class DashboardError extends Error {}

export interface Revenue extends MethodSplit {
  total: Money;
  orders: number;
  /** Phần phí ship nằm trong `total` (chỉ có ở tổng, không có ở từng ngày / điểm của báo cáo). */
  ship_fee?: Money;
}

export interface Dashboard {
  date: string;
  server_now: string;
  wait: { yellow_min: number; red_min: number };
  revenue: Revenue;
  by_point: Array<Revenue & { point_id: string; point_name: string }>;
  debt_collected: { cash: Money; transfer: Money };
  deleted: { count: number; served: number };
  open_shifts: Array<{ shift_id: string; staff_name: string; tablet_name: string; opened_at: string }>;
  active_orders: Array<{
    id: string;
    code: string;
    label: string | null;
    status: OrderStatus;
    created_at: string;
    served_at: string | null;
    total: Money;
    tablet_name: string;
    point_name: string;
  }>;
}

export async function loadDashboard(client: SupabaseClient): Promise<Dashboard> {
  const { data, error } = await client.rpc('owner_dashboard');
  if (error) throw new DashboardError(`Không tải được tổng quan: ${error.message}`);
  return data as Dashboard;
}
