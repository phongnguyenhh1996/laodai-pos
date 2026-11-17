import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { lineSummary } from '@/domain/cart';
import { parseCountInput, parseMoneyInput } from '@/domain/catalog';
import { formatSigned, formatVnd } from '@/domain/money';
import { hhmm } from '@/domain/time';
import type { AdjustmentKind } from '@/domain/types';
import { useOwner } from '../OwnerContext';
import { NavItem, NavList, OwnerLayout } from '../OwnerLayout';
import { addAdjustment, listShifts, loadShiftDetail, type ShiftDetail, type ShiftOrderRow, type ShiftRow } from './api';

/** `/owner/shifts/*` (mục 7, màn chủ số 2). */
export function ShiftRoutes() {
  return (
    <Routes>
      <Route index element={<ShiftList />} />
      <Route path=":shiftId" element={<ShiftDetailPage />} />
    </Routes>
  );
}

const dayTime = (at: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date(at)) + ' ' + hhmm(at);

const range = (s: ShiftRow) => `${dayTime(s.opened_at)}–${s.closed_at ? hhmm(s.closed_at) : 'đang mở'}`;

function ShiftList() {
  const { client } = useOwner();
  const [rows, setRows] = useState<ShiftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    listShifts(client)
      .then((r) => alive && setRows(r))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client]);

  return (
    <OwnerLayout title="Ca" back="/owner" testId="shift-list">
      <ErrorText testId="shift-error">{error}</ErrorText>
      {!rows && !error && <Splash />}
      {rows?.length === 0 && <p className="text-ink-subtle">Chưa có ca nào.</p>}
      {rows && rows.length > 0 && (
        <NavList>
          {rows.map((s) => (
            <NavItem
              key={s.id}
              to={`/owner/shifts/${s.id}`}
              testId={`shift-row-${s.id}`}
              title={`${s.staff_name} – ${s.tablet_name}`}
              live={s.status === 'open'}
              subtitle={`${range(s)}${s.recalculated_at ? ' · đã điều chỉnh' : ''}`}
            />
          ))}
        </NavList>
      )}
    </OwnerLayout>
  );
}

function ShiftDetailPage() {
  const { shiftId = '' } = useParams();
  const { client } = useOwner();
  const [detail, setDetail] = useState<ShiftDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDetail(await loadShiftDetail(client, shiftId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [client, shiftId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const s = detail?.shift;
  return (
    <OwnerLayout title={s ? `Ca ${s.staff_name} – ${s.tablet_name}` : 'Ca'} back="/owner/shifts" testId="shift-detail">
      <ErrorText testId="shift-error">{error}</ErrorText>
      {detail === undefined && !error && <Splash />}
      {detail === null && <p className="text-ink-subtle">Không có ca này.</p>}
      {detail && <ShiftBody detail={detail} onChanged={reload} />}
    </OwnerLayout>
  );
}

function ShiftBody({ detail, onChanged }: { detail: ShiftDetail; onChanged: () => Promise<void> }) {
  const { shift: s, reconcile: r, adjustments } = detail;
  const adj = (k: AdjustmentKind) => adjustments.filter((a) => a.kind === k).reduce((n, a) => n + a.qty, 0);
  const closed = s.status === 'closed';

  return (
    <div className="flex flex-col gap-4" data-testid="shift-report" data-status={s.status}>
      <p className="text-ink-muted" data-testid="shift-range">
        {range(s)}
        {s.recalculated_at && (
          <span className="ml-2 rounded bg-warning-soft px-2 py-0.5 text-sm text-warning-strong" data-testid="shift-adjusted">
            đã điều chỉnh
          </span>
        )}
      </p>

      <Card title="Doanh thu">
        <Row label="Tổng" value={formatVnd(r.revenue.total)} testId="rep-revenue" strong />
        <Row label="Tiền mặt · Chuyển khoản · Nợ" value={`${formatVnd(r.revenue.cash)} · ${formatVnd(r.revenue.transfer)} · ${formatVnd(r.revenue.debt)}`} testId="rep-revenue-split" />
        <Row label="Số đơn đã thu" value={String(r.paid_orders)} testId="rep-paid-orders" />
        {(r.debt_collected.cash > 0 || r.debt_collected.transfer > 0) && (
          <Row label="Thu nợ (TM · CK)" value={`${formatVnd(r.debt_collected.cash)} · ${formatVnd(r.debt_collected.transfer)}`} testId="rep-debt-collected" />
        )}
      </Card>

      <Card title="Tiền mặt">
        <Row label="Tiền lẻ đầu ca" value={formatVnd(s.open_float)} testId="rep-cash-float" />
        <Row label="Chủ bổ sung" value={formatVnd(adj('cash'))} testId="rep-cash-adj" />
        <Row label="Kỳ vọng" value={formatVnd(r.cash.expected)} testId="rep-cash-expected" strong />
        {closed && <Row label="Đếm được" value={formatVnd(r.cash.counted ?? 0)} testId="rep-cash-counted" />}
        {closed && <Row label="Chênh lệch" value={formatSigned(r.cash.diff ?? 0)} testId="rep-cash-diff" strong alert={!!r.cash.diff} />}
      </Card>

      <Card title="Hộp">
        <Row label="Đầu ca + bổ sung" value={`${s.open_boxes} + ${adj('boxes')} = ${s.open_boxes + adj('boxes')}`} testId="rep-boxes-supply" />
        {closed && <Row label="Còn lại" value={String(s.close_boxes_left)} testId="rep-boxes-left" />}
        <Row label="Thực dùng / theo đơn" value={`${r.boxes.used ?? '–'} / ${r.boxes.by_orders}`} testId="rep-boxes" />
        {closed && <Row label="Chênh lệch" value={formatSigned(r.boxes.diff ?? 0, false)} testId="rep-boxes-diff" strong alert={!!r.boxes.diff} />}
      </Card>

      <Card title="Dĩa">
        <Row label="Đầu ca + bổ sung" value={`${s.open_plates} + ${adj('plates')} = ${s.open_plates + adj('plates')}`} testId="rep-plates-supply" />
        {closed && <Row label="Còn lại" value={String(s.close_plates_left)} testId="rep-plates-left" />}
        <Row label="Thực dùng / theo đơn" value={`${r.plates.used ?? '–'} / ${r.plates.by_orders}`} testId="rep-plates" />
        {closed && <Row label="Chênh lệch" value={formatSigned(r.plates.diff ?? 0, false)} testId="rep-plates-diff" strong alert={!!r.plates.diff} />}
      </Card>

      <Card title="Xóa & đơn mở">
        <Row label="Đơn đã xóa" value={`${r.deleted_count} (${r.deleted_after_served.length} đã ra món)`} testId="rep-deleted" />
        {r.deleted_after_served.length > 0 && (
          <Row
            label="Bao bì của đơn bị xóa sau khi ra món"
            value={r.deleted_after_served.map((d) => `${d.code} (${d.boxes} hộp${d.plates ? `, ${d.plates} dĩa` : ''})`).join(', ')}
            testId="rep-deleted-after-served"
            strong
          />
        )}
        <Row label="Đơn còn mở" value={String(r.open_orders)} testId="rep-open-orders" />
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-ink-muted">Sửa đơn đang mở</span>
          <Link to={`/owner/log?type=edits&staff=${s.staff_id}`} className="underline" data-testid="rep-edits">
            {detail.edits} lần
          </Link>
        </p>
      </Card>

      <Card title="Bổ sung giữa ca">
        {adjustments.length === 0 && <p className="text-ink-subtle">Chưa có.</p>}
        {adjustments.map((a) => (
          <p key={a.id} data-testid="adjustment-row" className="text-base">
            {hhmm(a.at)} · +{a.kind === 'cash' ? formatVnd(a.qty) : a.qty} {KIND_LABEL[a.kind]}
            {a.note ? ` · ${a.note}` : ''}
          </p>
        ))}
        <AdjustForm shiftId={s.id} onSaved={onChanged} />
      </Card>

      <Card title={`Đơn của ca (${detail.orders.length})`}>
        <p className="text-sm text-ink-subtle">Đơn mở trong ca này hoặc thu tiền trong ca này.</p>
        {detail.orders.map((o) => (
          <OrderLine key={o.id} o={o} />
        ))}
      </Card>
    </div>
  );
}

const KIND_LABEL: Record<AdjustmentKind, string> = { boxes: 'hộp', plates: 'dĩa', cash: 'tiền lẻ' };

const STATUS_LABEL: Record<ShiftOrderRow['status'], string> = { open: 'chờ ra món', served: 'chờ thanh toán', paid: 'đã thu', deleted: 'đã xóa' };
const METHOD_LABEL = { cash: 'TM', transfer: 'CK', debt: 'Nợ' } as const;

function OrderLine({ o }: { o: ShiftOrderRow }) {
  return (
    <div data-testid={`shift-order-${o.id}`} data-status={o.status} className="flex flex-col border-t border-line py-2">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <Link to={`/owner/orders/${o.id}`} className="font-mono font-bold underline">
            {o.code}
          </Link> {o.label ? `· ${o.label} ` : ''}· {hhmm(o.created_at)} ·{' '}
          <span className={o.status === 'deleted' ? 'text-danger-strong' : ''}>{STATUS_LABEL[o.status]}</span>
          {o.payment_method && ` · ${METHOD_LABEL[o.payment_method]}`}
        </span>
        <b className={o.status === 'deleted' ? 'line-through' : ''}>{formatVnd(o.total)}</b>
      </p>
      <p className="text-sm text-ink-muted">{o.items.map(lineSummary).join(' · ')}</p>
      <p className="text-sm text-ink-subtle" data-testid={`shift-order-${o.id}-who`}>
        Mở: {o.opened_by}
        {o.paid_by ? ` · Thu: ${o.paid_by}` : ''}
      </p>
    </div>
  );
}

function AdjustForm({ shiftId, onSaved }: { shiftId: string; onSaved: () => Promise<void> }) {
  const { client } = useOwner();
  const [kind, setKind] = useState<AdjustmentKind>('boxes');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = kind === 'cash' ? parseMoneyInput(qty) : parseCountInput(qty);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed) {
      setError('Nhập số lớn hơn 0');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addAdjustment(client, shiftId, kind, parsed, note);
      setQty('');
      setNote('');
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-2 flex flex-col gap-3 rounded-xl bg-surface-muted p-3" onSubmit={submit} data-testid="adjust-form">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Loại bổ sung">
        {(['boxes', 'plates', 'cash'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className="btn btn-segment"
            data-testid={`adjust-kind-${k}`}
          >
            {k === 'boxes' ? 'Hộp' : k === 'plates' ? 'Dĩa' : 'Tiền lẻ'}
          </button>
        ))}
      </div>
      <TextField label={kind === 'cash' ? 'Số tiền bổ sung' : 'Số lượng bổ sung'} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="adjust-qty" />
      <TextField label="Ghi chú (tùy chọn)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="adjust-note" />
      <ErrorText testId="adjust-error">{error}</ErrorText>
      <button type="submit" className="btn btn-primary" disabled={busy} data-testid="adjust-submit">
        {kind === 'cash' && parsed ? `Bổ sung ${formatVnd(parsed)}` : 'Bổ sung'}
      </button>
    </form>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 card p-4">
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, testId, strong, alert }: { label: string; value: string; testId: string; strong?: boolean; alert?: boolean }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className={`text-right ${strong ? 'font-bold' : ''} ${alert ? 'text-danger-strong' : ''}`} data-testid={testId} data-alert={alert ? 'true' : undefined}>
        {value}
      </span>
    </p>
  );
}
