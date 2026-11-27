// Kiểu kết quả đối soát ca. Implementation duy nhất là SQL `private.reconcile_shift` (ghim bằng
// tests/fixtures/reconcile-cases.json, chạy ở tests/db/reconcile.test.ts). Thuần TS, không import gì
// ⇒ dùng chung cho app (màn chủ) và Edge Function (tin Telegram).

/** Thứ được đếm cuối ca. */
export type CountItem = 'cash' | 'boxes' | 'plates' | 'cans';

export interface CountLine {
  /** null khi ca chưa đóng hoặc ca không đếm thứ này. */
  used: number | null;
  by_orders: number;
  /** used − by_orders. */
  diff: number | null;
}

/** Thống kê ship (chỉ chủ): đơn ship đã thu trong ca / kỳ. Cùng công thức với `private.ship_stats`. */
export interface ShipStats {
  shop_orders: number;
  external_orders: number;
  /** Σ phí ship của đơn quán ship. */
  shop_fee: number;
  /** Σ phụ thu của đơn shipper ngoài. */
  external_fee: number;
  /** Σ tiền trả shipper ngoài (tiền mặt lấy từ két). */
  payout: number;
  /** Lãi/lỗ ship ngoài = phụ thu ship ngoài − trả shipper ngoài. */
  external_profit: number;
}

export interface DeletedAfterServed {
  order_id: string;
  code: string;
  boxes: number;
  plates: number;
  cans: number;
}

/** Kết quả `reconcile_shift` hiện hành (RPC luôn trả đủ trường). */
export interface ReconcileResult {
  /** Các thứ ca này đếm; thứ không đếm ⇒ `used`/`diff` (hoặc `cash.counted`/`diff`) = null, giao diện ẩn hẳn. */
  count_items: CountItem[];
  /** `ship_fee`: phần phí ship nằm trong `total` (không cộng thêm). */
  revenue: { total: number; cash: number; transfer: number; debt: number; ship_fee: number };
  ship: ShipStats;
  paid_orders: number;
  debt_collected: { cash: number; transfer: number };
  /** Khoản chi chưa hủy của ca: số khoản + tổng (đã trừ vào `cash.expected`). */
  expenses: { count: number; total: number };
  cash: { expected: number; counted: number | null; diff: number | null };
  boxes: CountLine;
  plates: CountLine;
  cans: CountLine;
  deleted_count: number;
  deleted_after_served: DeletedAfterServed[];
  open_orders: number;
}

/**
 * Đối soát đã lưu (payload thông báo, đối soát trước / sau khi tính lại): bản ghi cũ thiếu các trường thêm sau.
 * Thêm trường mới vào `ReconcileResult` mà bản ghi cũ không có ⇒ thêm nó vào đây dạng optional.
 */
export type StoredReconcile = Omit<ReconcileResult, 'count_items' | 'revenue' | 'ship' | 'expenses' | 'cans' | 'deleted_after_served'> & {
  /** Thiếu ⇒ tiền mặt, hộp, dĩa. */
  count_items?: CountItem[];
  revenue: Omit<ReconcileResult['revenue'], 'ship_fee'> & { ship_fee?: number };
  ship?: ShipStats;
  expenses?: ReconcileResult['expenses'];
  cans?: CountLine;
  deleted_after_served: Array<Omit<DeletedAfterServed, 'cans'> & { cans?: number }>;
};
