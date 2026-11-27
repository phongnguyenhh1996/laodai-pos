/**
 * Kết quả đối soát cuối ca. Công thức chỉ có một implementation: SQL `private.reconcile_shift`
 * (ghim bằng tests/fixtures/reconcile-cases.json, test ở tests/db/reconcile.test.ts). App chỉ đọc kết quả.
 */
export type { CountLine, DeletedAfterServed, ReconcileResult, ShipStats } from '../../supabase/functions/_shared/reconcile';
