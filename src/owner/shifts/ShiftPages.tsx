import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Banknote, CircleAlert, CircleCheck, Clock, Pencil, Plus, Users } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { parseCountInput, parseMoneyInput } from '@/domain/catalog';
import { formatSigned, formatVnd } from '@/domain/money';
import { shiftDate, shortDate } from '@/domain/report';
import { businessDate, hhmm } from '@/domain/time';
import type { AdjustmentKind } from '@/domain/types';
import { useOwner } from '../OwnerContext';
import { Chip, OwnerLayout } from '../OwnerLayout';
import { KV, PageHead, Section, TONE, card } from '../ui';
import { addAdjustment, loadShiftBoard, loadShiftDetail, type ShiftCard, type ShiftDetail, type ShiftOrderRow, type ShiftRow } from './api';

/** `/owner/shifts/*` (mục 7, màn chủ số 2). */
export function ShiftRoutes() {
  return (
    <Routes>
      <Route index element={<ShiftList />} />
      <Route path=":shiftId" element={<ShiftDetailPage />} />
    </Routes>
  );
}

const ddmm = (at: string) => shortDate(businessDate(new Date(at)));

/** "20:13 – 20:17", "20:17 – đang mở", "23:00 – 16:11 (19/11)". */
function timeRange(s: Pick<ShiftRow, 'opened_at' | 'closed_at'>): string {
  if (!s.closed_at) return `${hhmm(s.opened_at)} – đang mở`;
  const sameDay = ddmm(s.opened_at) === ddmm(s.closed_at);
  return `${hhmm(s.opened_at)} – ${hhmm(s.closed_at)}${sameDay ? '' : ` (${ddmm(s.closed_at)})`}`;
}

function duration(s: Pick<ShiftRow, 'opened_at' | 'closed_at'>): string {
  if (!s.closed_at) return 'đang mở';
  const m = Math.max(0, Math.round((Date.parse(s.closed_at) - Date.parse(s.opened_at)) / 60_000));
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase();

type Period = 'today' | '7d' | 'month';
const PERIODS: Array<[Period, string]> = [
  ['today', 'Hôm nay'],
  ['7d', '7 ngày'],
  ['month', 'Tháng này'],
];

/** Thanh chọn kiểu Makaryo (nền xám, mục chọn nổi trắng). */
export function Segmented<K extends string>({
  items,
  value,
  onChange,
  testIdPrefix,
  accent = false,
}: {
  items: Array<[K, string]>;
  value: K;
  onChange: (k: K) => void;
  testIdPrefix: string;
  /** Chữ mục chọn màu cam (Figma "Bổ sung giữa ca"). */
  accent?: boolean;
}) {
  return (
    <div role="group" className="grid h-10 auto-cols-fr grid-flow-col gap-1 rounded-xl bg-[#efefef] p-1">
      {items.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(k)}
            className={`rounded-[9px] text-[13px] leading-4 transition-colors duration-fast ${
              on ? `bg-white font-semibold shadow-[0_4px_16px_rgb(0_0_0/0.06)] ${accent ? 'text-[#c2380a]' : 'text-[#111]'}` : 'font-medium text-[#6d6d6d] hover:text-[#111]'
            }`}
            data-testid={`${testIdPrefix}-${k}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** `/owner/shifts?period=today|7d|month` (mặc định 7 ngày). Figma R20 / T25. */
function ShiftList() {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const [params, setParams] = useSearchParams();
  const period = (['today', '7d', 'month'] as const).find((p) => p === params.get('period')) ?? '7d';
  const today = businessDate(new Date());
  const from = period === 'today' ? today : period === '7d' ? shiftDate(today, -6) : `${today.slice(0, 8)}01`;
  const [rows, setRows] = useState<ShiftCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    loadShiftBoard(client, from, today)
      .then((r) => alive && setRows(r))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client, from, today]);

  const groups = new Map<string, ShiftCard[]>();
  for (const s of rows ?? []) {
    const d = businessDate(new Date(s.opened_at));
    groups.set(d, [...(groups.get(d) ?? []), s]);
  }
  const days = [...groups.keys()].sort().reverse();
  const open = rows?.filter((s) => s.status === 'open').length ?? 0;
  const closed = rows?.filter((s) => s.status === 'closed').length ?? 0;
  const off = rows?.filter((s) => s.status === 'closed' && s.reconcile.cash.diff).length ?? 0;
  const subtitle = 'Đối soát từng ca · bổ sung hộp / dĩa / tiền giữa ca';

  return (
    <OwnerLayout title={isTablet ? 'Ca làm việc' : 'Ca'} subtitle={isTablet ? subtitle : undefined} back="/owner" wide testId="shift-list">
      <div className="flex flex-col gap-3.5 md:gap-5">
        {!isTablet && <PageHead title="Ca làm việc" subtitle={subtitle} />}
        <Segmented items={PERIODS} value={period} onChange={(p) => setParams({ period: p }, { replace: true })} testIdPrefix="shift-period" />
        <div className="grid grid-cols-3 gap-2.5">
          <Stat icon={<Users className="h-4 w-4" />} tone={TONE.green} value={open} label="Đang mở" />
          <Stat icon={<CircleCheck className="h-4 w-4" />} tone={TONE.gray} value={closed} label="Đã đóng" />
          <Stat icon={<CircleAlert className="h-4 w-4" />} tone={TONE.red} value={off} label="Lệch tiền" />
        </div>
        <ErrorText testId="shift-error">{error}</ErrorText>
        {!rows && !error && <Splash />}
        {rows?.length === 0 && <p className="py-6 text-center text-sm text-[#888]">Chưa có ca nào.</p>}
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:items-start md:gap-5">
          {days.map((d) => (
            <section key={d} className="flex flex-col gap-3.5 md:gap-4">
              <h2 className="num text-xs font-semibold uppercase leading-[15px] tracking-normal text-[#888]">{d === today ? `Hôm nay · ${shortDate(d)}` : shortDate(d)}</h2>
              {groups.get(d)!.map((s) => (
                <ShiftTile key={s.id} s={s} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </OwnerLayout>
  );
}

function Stat({ icon, tone, value, label }: { icon: ReactNode; tone: string; value: number; label: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3">
      <span aria-hidden className={`flex h-[30px] w-[30px] items-center justify-center rounded-[9px] ${tone}`}>
        {icon}
      </span>
      <span className="flex flex-col">
        <b className="num text-xl leading-[26px]">{value}</b>
        <span className="text-xs leading-[15px] text-[#888]">{label}</span>
      </span>
    </div>
  );
}

function StatusChip({ s, diff }: { s: Pick<ShiftRow, 'status'>; diff: number | null }) {
  if (s.status === 'open')
    return (
      <Chip className={TONE.green}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
        Đang mở
      </Chip>
    );
  return diff ? (
    <Chip className={`num ${TONE.red}`}>
      <CircleAlert aria-hidden className="h-3.5 w-3.5" />
      Lệch {formatSigned(diff)}
    </Chip>
  ) : (
    <Chip className={TONE.gray}>
      <CircleCheck aria-hidden className="h-3.5 w-3.5" />
      Khớp tiền
    </Chip>
  );
}

function ShiftTile({ s }: { s: ShiftCard }) {
  const live = s.status === 'open';
  return (
    <Link
      to={`/owner/shifts/${s.id}`}
      className={`flex flex-col gap-3 rounded-2xl border bg-white p-3.5 transition-colors duration-fast ${live ? 'border-[#bbe5ca] hover:border-[#16a34a]' : 'border-line hover:border-line-strong'}`}
      data-testid={`shift-row-${s.id}`}
      data-status={s.status}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${live ? TONE.green : TONE.orange}`}>
            {initial(s.staff_name)}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[15px] font-semibold leading-[19px]">{s.staff_name}</span>
            <span className="truncate text-xs leading-[15px] text-[#888]">{[s.tablet_name, s.point_names].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <StatusChip s={s} diff={s.reconcile.cash.diff} />
          {s.recalculated_at && <Chip className={`${TONE.amber} !px-2 !py-0.5 !text-[11px]`}>đã điều chỉnh</Chip>}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 rounded-[10px] bg-[#f8f8f8] px-3 py-2.5">
        <span className="num flex items-center gap-1.5 text-[13px] font-medium leading-4 text-[#6d6d6d]">
          <Clock aria-hidden className="h-3.5 w-3.5" />
          {timeRange(s)}
        </span>
        <b className="num text-sm leading-[18px]">{formatVnd(s.reconcile.revenue.total)}</b>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------- chi tiết ca

/** `/owner/shifts/:shiftId` (Figma R21 / T26). */
function ShiftDetailPage() {
  const { shiftId = '' } = useParams();
  const { client } = useOwner();
  const isTablet = useIsTablet();
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
    <OwnerLayout
      title="Chi tiết ca"
      subtitle={isTablet && s ? `${s.staff_name} – ${s.tablet_name} · ${ddmm(s.opened_at)} ${timeRange(s)}` : undefined}
      back="/owner/shifts"
      tabBar
      wide
      testId="shift-detail"
    >
      <ErrorText testId="shift-error">{error}</ErrorText>
      {detail === undefined && !error && <Splash />}
      {detail === null && <p className="text-[#888]">Không có ca này.</p>}
      {detail && <ShiftBody detail={detail} onChanged={reload} />}
    </OwnerLayout>
  );
}

function ShiftBody({ detail, onChanged }: { detail: ShiftDetail; onChanged: () => Promise<void> }) {
  const { shift: s, reconcile: r, adjustments } = detail;
  const adj = (k: AdjustmentKind) => adjustments.filter((a) => a.kind === k).reduce((n, a) => n + a.qty, 0);
  const closed = s.status === 'closed';
  const diff = r.cash.diff ?? 0;
  const debtIn = r.debt_collected.cash + r.debt_collected.transfer;

  const summary = (
    <section className={`${card} gap-3.5 p-4`} data-testid="shift-report" data-status={s.status}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-3">
          <span aria-hidden className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full text-lg font-bold ${closed ? TONE.orange : TONE.green}`}>
            {initial(s.staff_name)}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <b className="truncate text-[17px] leading-[22px]">
              {s.staff_name} – {s.tablet_name}
            </b>
            <span className="num truncate text-xs leading-[15px] text-[#888]" data-testid="shift-range">
              {ddmm(s.opened_at)} · {timeRange(s)} · {duration(s)}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {closed ? (
            <Chip className={TONE.gray}>
              <CircleCheck aria-hidden className="h-3.5 w-3.5" />
              Đã đóng
            </Chip>
          ) : (
            <StatusChip s={s} diff={null} />
          )}
          {s.recalculated_at && (
            <Chip className={`${TONE.amber} !px-2 !py-0.5 !text-[11px]`} testId="shift-adjusted">
              đã điều chỉnh
            </Chip>
          )}
        </span>
      </div>
      <div className="grid grid-cols-3 items-center gap-2">
        <Tile tone="bg-[#ffeee7]" value={<span data-testid="rep-revenue">{formatVnd(r.revenue.total)}</span>} label="Doanh thu" />
        <Tile tone="bg-[#f8f8f8]" value={<span data-testid="rep-paid-orders">{r.paid_orders}</span>} label="Đơn đã thu" />
        {closed ? (
          <Tile tone={diff ? 'bg-[#fdecec]' : 'bg-[#e8f7ee]'} value={formatSigned(diff)} label="Chênh lệch tiền" />
        ) : (
          <Tile tone="bg-[#f8f8f8]" value={formatVnd(r.cash.expected)} label="Tiền mặt kỳ vọng" />
        )}
      </div>
      <p className="num flex flex-wrap gap-x-3.5 gap-y-1 text-xs leading-[15px] text-[#6d6d6d]">
        <span data-testid="rep-revenue-split">
          <span>TM {formatVnd(r.revenue.cash)}</span>
          <span className="sr-only"> · </span>
          <span className="ml-3.5">CK {formatVnd(r.revenue.transfer)}</span>
          <span className="sr-only"> · </span>
          <span className="ml-3.5">Nợ {formatVnd(r.revenue.debt)}</span>
        </span>
        {debtIn > 0 && (
          <span data-testid="rep-debt-collected">
            Thu nợ TM {formatVnd(r.debt_collected.cash)} · CK {formatVnd(r.debt_collected.transfer)}
          </span>
        )}
      </p>
    </section>
  );

  const cash = (
    <Section
      title="Tiền mặt"
      subtitle="Đối soát két cuối ca"
      right={
        <span aria-hidden className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${TONE.green}`}>
          <Banknote className="h-[17px] w-[17px]" />
        </span>
      }
    >
      <div className="flex flex-col">
        <KV roomy label="Tiền lẻ đầu ca">
          <span data-testid="rep-cash-float">{formatVnd(s.open_float)}</span>
        </KV>
        <KV roomy label="Chủ bổ sung">
          <span data-testid="rep-cash-adj">{formatVnd(adj('cash'))}</span>
        </KV>
        <KV roomy label="Kỳ vọng">
          <span data-testid="rep-cash-expected">{formatVnd(r.cash.expected)}</span>
        </KV>
        {closed && (
          <KV roomy label="Đếm được">
            <span data-testid="rep-cash-counted">{formatVnd(r.cash.counted ?? 0)}</span>
          </KV>
        )}
        {closed && (
          <p className="mt-0 flex items-center justify-between gap-2.5 border-t border-line pt-3 text-sm leading-[18px]">
            <span className="font-semibold">Chênh lệch</span>
            <Chip className={`num ${diff ? TONE.red : TONE.green}`}>
              {diff ? <CircleAlert aria-hidden className="h-3.5 w-3.5" /> : <CircleCheck aria-hidden className="h-3.5 w-3.5" />}
              <span data-testid="rep-cash-diff" data-alert={diff ? 'true' : undefined}>
                {formatSigned(diff)}
              </span>
              {diff ? ' · Lệch' : ' · Khớp'}
            </Chip>
          </p>
        )}
      </div>
    </Section>
  );

  const cells = (k: 'boxes' | 'plates') => {
    const line = r[k];
    const open = k === 'boxes' ? s.open_boxes : s.open_plates;
    const left = k === 'boxes' ? s.close_boxes_left : s.close_plates_left;
    return {
      supply: (
        <span data-testid={`rep-${k}-supply`}>
          {open} + {adj(k)}
        </span>
      ),
      left: <span data-testid={`rep-${k}-left`}>{left}</span>,
      used: (
        <span data-testid={`rep-${k}`}>
          {line.used ?? '–'} / {line.by_orders}
        </span>
      ),
      diff: (
        <span data-testid={`rep-${k}-diff`} data-alert={line.diff ? 'true' : undefined} className={line.diff ? 'text-[#b91c1c]' : ''}>
          {formatSigned(line.diff ?? 0, false)}
        </span>
      ),
    };
  };
  const b = cells('boxes');
  const p = cells('plates');
  const packs = (
    <section className={`${card} overflow-hidden`}>
      <h2 className="p-3.5 text-base font-bold leading-5 tracking-normal">Hộp & dĩa</h2>
      <div className={`${tableRow} bg-[#f8f8f8] py-2.5 text-xs font-medium leading-[15px] text-[#6d6d6d]`}>
        <span />
        <span className="text-right">Hộp</span>
        <span className="text-right">Dĩa</span>
      </div>
      <PackRow label="Đầu ca + bổ sung" a={b.supply} b={p.supply} />
      {closed && <PackRow label="Còn lại" a={b.left} b={p.left} />}
      <PackRow label="Thực dùng / theo đơn" a={b.used} b={p.used} />
      {closed && <PackRow label="Chênh lệch" a={b.diff} b={p.diff} />}
    </section>
  );

  const issues = detail.billIssues;
  const deletes = (
    <Section title="Xóa & đơn mở">
      <div className="grid grid-cols-2 gap-x-2 gap-y-3.5">
        <Tile tone={r.deleted_after_served.length ? 'bg-[#fdecec]' : 'bg-[#f8f8f8]'} value={r.deleted_count} label={`Đơn đã xóa (${r.deleted_after_served.length} ra món)`} testId="rep-deleted" />
        <Tile tone={r.open_orders ? 'bg-[#fef5e1]' : 'bg-[#f8f8f8]'} value={r.open_orders} label="Đơn còn mở" testId="rep-open-orders" />
        <Tile
          tone={issues.length ? 'bg-[#fdecec]' : 'bg-[#f8f8f8]'}
          value={issues.length}
          label={issues.length ? `Bill in lỗi / không in: ${issues.map((x) => `${x.code}${x.status === 'failed' ? ' (lỗi)' : ''}`).join(', ')}` : 'Bill in lỗi / không in'}
          testId="rep-bill-issues"
        />
        <Tile
          to={`/owner/log?type=edits&staff=${s.staff_id}`}
          tone={detail.edits ? 'bg-[#fef5e1] hover:bg-[#fdecc4]' : 'bg-[#f8f8f8] hover:bg-[#f0f0f0]'}
          value={detail.edits}
          label="Sửa đơn đang mở"
          testId="rep-edits"
        />
      </div>
      {r.deleted_after_served.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-[#fdecec] px-3 py-2.5 text-[13px] leading-[18px] text-[#b91c1c]">
          <CircleAlert aria-hidden className="mt-px h-4 w-4 shrink-0" />
          <span>
            Bao bì của đơn bị xóa sau khi ra món:{' '}
            <b data-testid="rep-deleted-after-served">{r.deleted_after_served.map((d) => `${d.code} (${d.boxes} hộp${d.plates ? `, ${d.plates} dĩa` : ''})`).join(', ')}</b>
          </span>
        </p>
      )}
    </Section>
  );

  const adjust = (
    <Section title="Bổ sung giữa ca" subtitle={adjustments.length === 0 ? 'Chưa có lần bổ sung nào' : `${adjustments.length} lần bổ sung`}>
      {adjustments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {adjustments.map((a) => (
            <li key={a.id} data-testid="adjustment-row" className="num flex items-center gap-2 rounded-[10px] bg-[#f8f8f8] px-3 py-2 text-[13px] leading-4">
              <b className="font-semibold text-[#c2380a]">
                +{a.kind === 'cash' ? formatVnd(a.qty) : a.qty} {KIND_LABEL[a.kind]}
              </b>
              <span className="min-w-0 flex-1 truncate text-[#888]">
                {hhmm(a.at)}
                {a.note ? ` · ${a.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <AdjustForm shiftId={s.id} onSaved={onChanged} />
    </Section>
  );

  const orders = (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-col gap-0.5 p-3.5">
        <h2 className="text-base font-bold leading-5 tracking-normal">Đơn của ca ({detail.orders.length})</h2>
        <p className="text-xs leading-[15px] text-[#888]">Đơn mở hoặc thu tiền trong ca này</p>
      </div>
      {detail.orders.map((o) => (
        <OrderLine key={o.id} o={o} />
      ))}
    </section>
  );

  return (
    <div className="flex flex-col gap-3.5 md:gap-5">
      {summary}
      <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:items-start md:gap-5">
        <div className="flex flex-col gap-3.5 md:gap-4">
          {cash}
          {packs}
          {deletes}
        </div>
        <div className="flex flex-col gap-3.5 md:gap-4">
          {adjust}
          {orders}
        </div>
      </div>
    </div>
  );
}

const tableRow = 'grid grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-2 px-3.5';

function PackRow({ label, a, b }: { label: string; a: ReactNode; b: ReactNode }) {
  return (
    <div className={`${tableRow} num border-b border-line py-[11px] text-sm leading-[18px] last:border-b-0`}>
      <span>{label}</span>
      <b className="text-right font-semibold">{a}</b>
      <b className="text-right font-semibold">{b}</b>
    </div>
  );
}

function Tile({ tone, value, label, testId, to }: { tone: string; value: ReactNode; label: string; testId?: string; to?: string }) {
  const body = (
    <>
      <b className="num text-lg leading-[23px]">{value}</b>
      <span className="text-[11px] leading-[14px] text-[#888]">{label}</span>
    </>
  );
  const cls = `flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-colors duration-fast ${tone}`;
  return to ? (
    <Link to={to} className={cls} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <span className={cls} data-testid={testId}>
      {body}
    </span>
  );
}

const KIND_LABEL: Record<AdjustmentKind, string> = { boxes: 'hộp', plates: 'dĩa', cash: 'tiền lẻ' };

const STATUS: Record<ShiftOrderRow['status'], [string, keyof typeof TONE]> = {
  open: ['Chờ ra món', 'amber'],
  served: ['Chờ thanh toán', 'blue'],
  paid: ['Đã thu', 'green'],
  deleted: ['Đã xóa', 'red'],
};
const METHOD_LABEL = { cash: 'TM', transfer: 'CK', debt: 'Nợ' } as const;

function OrderLine({ o }: { o: ShiftOrderRow }) {
  const [label, tone] = STATUS[o.status];
  const who = o.paid_by && o.paid_by === o.opened_by ? `Mở/Thu: ${o.opened_by}` : `Mở: ${o.opened_by}${o.paid_by ? ` · Thu: ${o.paid_by}` : ''}`;
  const meta = [hhmm(o.created_at), o.label || o.point_name, o.payment_method && METHOD_LABEL[o.payment_method]].filter(Boolean).join(' · ');
  return (
    <Link
      to={`/owner/orders/${o.id}`}
      data-testid={`shift-order-${o.id}`}
      data-status={o.status}
      className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-3 transition-colors duration-fast hover:bg-[#fafafa]"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <b className={`text-sm leading-[18px] ${o.status === 'deleted' ? 'line-through' : ''}`}>#{o.code}</b>
          <Chip className={`${TONE[tone]} !px-2 !py-0.5 !text-[11px] !leading-[14px]`}>{label}</Chip>
          {o.owner_edited && <Pencil aria-label="Chủ đã sửa" className="h-3.5 w-3.5 text-[#a16207]" />}
        </span>
        <span className="num truncate text-xs leading-[15px] text-[#888]">
          {meta} · <span data-testid={`shift-order-${o.id}-who`}>{who}</span>
        </span>
      </span>
      <b className={`num shrink-0 text-sm leading-[18px] ${o.status === 'deleted' ? 'text-[#888] line-through' : ''}`}>{formatVnd(o.total)}</b>
    </Link>
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

  const field = 'h-[45px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] leading-[19px] outline-none placeholder:text-[#a3a3a3] focus:border-brand';
  return (
    <form className="flex flex-col gap-3.5" onSubmit={submit} data-testid="adjust-form">
      <Segmented
        items={[
          ['boxes', 'Hộp'],
          ['plates', 'Dĩa'],
          ['cash', 'Tiền lẻ'],
        ]}
        value={kind}
        onChange={setKind}
        testIdPrefix="adjust-kind"
        accent
      />
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] font-medium leading-4 text-[#6d6d6d]">{kind === 'cash' ? 'Số tiền' : 'Số lượng'}</span>
          <input className={`num ${field}`} inputMode="numeric" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="adjust-qty" />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] font-medium leading-4 text-[#6d6d6d]">Ghi chú (tùy chọn)</span>
          <input className={field} placeholder="VD: lấy thêm ở kho" value={note} onChange={(e) => setNote(e.target.value)} data-testid="adjust-note" />
        </label>
      </div>
      <ErrorText testId="adjust-error">{error}</ErrorText>
      <button
        type="submit"
        className="inline-flex h-[45px] items-center justify-center gap-2 rounded-xl bg-[#ffeee7] text-[15px] font-semibold leading-[19px] text-[#c2380a] hover:bg-[#ffe2d5] disabled:opacity-40"
        disabled={busy}
        data-testid="adjust-submit"
      >
        <Plus aria-hidden className="h-[17px] w-[17px]" />
        {kind === 'cash' && parsed ? `Bổ sung ${formatVnd(parsed)}` : 'Bổ sung'}
      </button>
    </form>
  );
}
