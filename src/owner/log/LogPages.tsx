import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, CircleAlert, ListChecks, UserRound, X } from 'lucide-react';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { ACTION_GROUPS, ACTION_LABELS, actionLabel, auditFlags, describeAudit, type AuditEntry } from '@/domain/audit';
import { shiftDate, shortDate } from '@/domain/report';
import { businessDate, dayTime, hhmm } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { IconTile, PageHead, SelectBox, TONE, card } from '../ui';
import { PAGE_SIZE, loadLog, loadLogNames, type LogNames } from './api';
import { actionVisual } from './visual';

export const day = (at: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
  })
    .format(new Date(at))
    .replace('-', '/') +
  ' ' +
  hhmm(at);

/** Đồng bộ trễ ≥ 2 phút (làm lúc offline) ⇒ hiện cả thời điểm thực hiện và đồng bộ, như tin Telegram. */
export function when(e: AuditEntry): string {
  const lag = Date.parse(e.synced_at) - Date.parse(e.at);
  return lag >= 2 * 60_000 ? `${day(e.at)} (đồng bộ ${day(e.synced_at)})` : day(e.at);
}

export function actor(e: AuditEntry, names: LogNames): string {
  if (e.actor_kind === 'owner') return 'Chủ';
  if (e.actor_kind === 'system') return 'Hệ thống';
  return (e.staff_id && names.staff.get(e.staff_id)) || 'Nhân viên';
}

export function useLog(filterKey: string, load: (after?: AuditEntry) => Promise<AuditEntry[]>) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    load()
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setMore(r.length === PAGE_SIZE);
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);
  const loadMore = async () => {
    if (!rows?.length) return;
    try {
      const next = await load(rows[rows.length - 1]);
      setRows([...rows, ...next]);
      setMore(next.length === PAGE_SIZE);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return { rows, more, error, loadMore };
}

export function useNames(): LogNames | null {
  const { client } = useOwner();
  const [names, setNames] = useState<LogNames | null>(null);
  useEffect(() => {
    let alive = true;
    loadLogNames(client)
      .then((n) => alive && setNames(n))
      .catch(
        () =>
          alive &&
          setNames({
            staff: new Map(),
            tablets: new Map(),
            customers: new Map(),
          }),
      );
    return () => {
      alive = false;
    };
  }, [client]);
  return names;
}

/** Lối tắt lọc nhanh (Figma R28 / T29): "" = mọi loại, còn lại là id nhóm trong ACTION_GROUPS. */
const QUICK: Array<[string, string]> = [
  ['', 'Tất cả'],
  ['orders', 'Đơn'],
  ['shifts', 'Ca'],
  ['print', 'In'],
  ['sold_out', 'Hết món'],
];

const CHIP = 'inline-flex h-[25px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold leading-[15px] transition-colors duration-fast';
const chipClass = (on: boolean) => `${CHIP} ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-[#6d6d6d] hover:text-[#111]'}`;

/** `/owner/log?type=…&staff=…&date=YYYY-MM-DD` (link trong tin Telegram dùng `?action=`). Figma R28 / T29. */
export function LogPage() {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? params.get('action') ?? '';
  const staffId = params.get('staff') ?? '';
  const date = params.get('date') ?? '';
  const names = useNames();
  const filterKey = `${type}|${staffId}|${date}`;
  const load = useCallback(
    (after?: AuditEntry) => loadLog(client, { type, staffId, date }, after),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, filterKey],
  );
  const { rows, more, error, loadMore } = useLog(filterKey, load);

  function set(key: 'type' | 'staff' | 'date', value: string) {
    const next = new URLSearchParams(params);
    next.delete('action');
    if (key !== 'type' && type) next.set('type', type);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const isGroup = ACTION_GROUPS.some((g) => g.id === type);
  const subtitle = 'Mọi thao tác trên các máy, mới nhất trước';
  const today = businessDate(new Date());
  const groups: Array<[string, AuditEntry[]]> = [];
  for (const e of rows ?? []) {
    const d = businessDate(new Date(e.at));
    const g = groups[groups.length - 1];
    if (g && g[0] === d) g[1].push(e);
    else groups.push([d, [e]]);
  }
  const dayHead = (d: string, at: string) => (d === today ? `Hôm nay · ${shortDate(d)}` : d === shiftDate(today, -1) ? `Hôm qua · ${shortDate(d)}` : dayTime(at).split(' · ')[0]);

  return (
    <OwnerLayout title={isTablet ? 'Nhật ký thao tác' : 'Nhật ký'} subtitle={isTablet ? subtitle : undefined} back={isTablet ? '/owner' : '/owner/more'} tabBar wide testId="log-page">
      <div className="flex flex-col gap-3.5 md:gap-5">
        {!isTablet && <PageHead title="Nhật ký thao tác" subtitle={subtitle} />}
        <div className="grid grid-cols-2 gap-2">
          <SelectBox icon={ListChecks} value={type} onChange={(e) => set('type', e.target.value)} data-testid="log-filter-type" aria-label="Loại">
            <option value="">Mọi loại</option>
            <optgroup label="Nhóm">
              {ACTION_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Từng loại">
              {Object.entries(ACTION_LABELS).map(([a, label]) => (
                <option key={a} value={a}>
                  {label}
                </option>
              ))}
            </optgroup>
            {type && !isGroup && !ACTION_LABELS[type] && <option value={type}>{type}</option>}
          </SelectBox>
          <SelectBox icon={UserRound} value={staffId} onChange={(e) => set('staff', e.target.value)} data-testid="log-filter-staff" aria-label="Nhân viên">
            <option value="">Mọi nhân viên</option>
            {[...(names?.staff ?? new Map<string, string>())].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectBox>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto" role="group" aria-label="Lọc nhanh">
          {QUICK.map(([k, label]) => (
            <button key={k || 'all'} type="button" aria-pressed={type === k} onClick={() => set('type', k)} className={chipClass(type === k)} data-testid={`log-quick-${k || 'all'}`}>
              {label}
            </button>
          ))}
          <span className={`relative ${chipClass(!!date)}`} title="Lọc theo ngày">
            <CalendarDays aria-hidden className="h-3.5 w-3.5" />
            {date && shortDate(date)}
            {/* Ô ngày gốc phủ lên chip: bấm là mở lịch của máy. */}
            <input
              type="date"
              value={date}
              onChange={(e) => set('date', e.target.value)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker();
                } catch {
                  /* trình duyệt cũ: ô ngày gốc tự xử lý */
                }
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Lọc theo ngày"
              data-testid="log-filter-date"
            />
          </span>
          {date && (
            <button
              type="button"
              onClick={() => set('date', '')}
              aria-label="Bỏ lọc ngày"
              className="-ml-1 flex h-[25px] w-[25px] shrink-0 items-center justify-center rounded-full text-[#888] hover:bg-white hover:text-[#111]"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <ErrorText testId="log-error">{error}</ErrorText>
        {(!rows || !names) && !error && <Splash />}
        {rows && names && rows.length === 0 && (
          <p className="py-6 text-center text-sm text-[#888]" data-testid="log-empty">
            Không có mục nào.
          </p>
        )}
        {rows && names && rows.length > 0 && (
          <div className="flex flex-col gap-3.5 md:gap-5" data-testid="log-list">
            {groups.map(([d, list]) => (
              <section key={d} className="flex flex-col gap-3.5 md:gap-5">
                <h2 className="num text-xs font-semibold uppercase leading-[15px] tracking-normal text-[#888]">{dayHead(d, list[0].at)}</h2>
                <ol className={`${card} overflow-hidden`}>
                  {list.map((e) => (
                    <LogRow key={e.id} e={e} names={names} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
        {more && (
          <button type="button" className="self-center px-3 py-1.5 text-[13px] font-semibold leading-4 text-brand hover:text-brand-deep" onClick={() => void loadMore()} data-testid="log-more">
            Tải thêm…
          </button>
        )}
      </div>
    </OwnerLayout>
  );
}

/** Giờ của dòng (đã nhóm theo ngày); đồng bộ trễ ≥ 2 phút thì kèm lúc đồng bộ. */
function rowTime(e: AuditEntry): string {
  const lag = Date.parse(e.synced_at) - Date.parse(e.at);
  return lag >= 2 * 60_000 ? `${hhmm(e.at)} (đồng bộ ${day(e.synced_at)})` : hhmm(e.at);
}

/** Nhãn đỏ dưới dòng nhật ký ("Xóa khi ĐÃ RA MÓN", lỗi in). */
export function AuditFlags({ e }: { e: AuditEntry }) {
  const flags = auditFlags(e);
  if (!flags.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <span key={f} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-semibold leading-[14px] ${TONE.red}`} data-testid="log-row-flag">
          <CircleAlert aria-hidden className="h-[13px] w-[13px]" />
          {f}
        </span>
      ))}
    </span>
  );
}

function LogRow({ e, names }: { e: AuditEntry; names: LogNames }) {
  const lines = describeAudit(e, {
    customer: (id) => names.customers.get(id) ?? id,
  });
  const code = (e.after as { code?: string } | null)?.code ?? (e.before as { code?: string } | null)?.code;
  const tablet = e.tablet_profile_id ? names.tablets.get(e.tablet_profile_id) : null;
  const v = actionVisual(e.action);
  return (
    <li className="flex gap-3 border-t border-line px-3.5 py-3 first:border-t-0" data-testid="log-row" data-action={e.action} data-entity={e.entity_id ?? ''}>
      <IconTile icon={v.icon} className="h-[34px] w-[34px] rounded-[10px]" iconClass="h-[17px] w-[17px]" tone={TONE[v.tone]} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-start justify-between gap-2">
          <b className="text-sm font-semibold leading-[18px]" data-testid="log-row-title">
            {actionLabel(e.action)}
            {code && e.entity === 'order' && (
              <>
                {' · '}
                <Link to={`/owner/orders/${e.entity_id}`} className="hover:text-brand hover:underline" data-testid="log-row-order">
                  #<span className="font-mono">{code}</span>
                </Link>
              </>
            )}
          </b>
          <span className="num mt-0.5 shrink-0 text-right text-xs leading-[15px] text-[#888]">{rowTime(e)}</span>
        </span>
        <span className="text-xs leading-[15px] text-[#888]" data-testid="log-row-actor">
          {actor(e, names)}
          {tablet ? ` – ${tablet}` : ''}
        </span>
        {lines.map((l, i) => (
          <span key={i} className="text-[13px] leading-[18px]" data-testid="log-row-line">
            {l}
          </span>
        ))}
        <AuditFlags e={e} />
      </span>
    </li>
  );
}
