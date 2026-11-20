import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { ACTION_GROUPS, ACTION_LABELS, actionLabel, describeAudit, type AuditEntry } from '@/domain/audit';
import { hhmm } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { PAGE_SIZE, loadLog, loadLogNames, type LogNames } from './api';

export const day = (at: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date(at)).replace('-', '/') + ' ' + hhmm(at);

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
      .catch(() => alive && setNames({ staff: new Map(), tablets: new Map(), customers: new Map() }));
    return () => {
      alive = false;
    };
  }, [client]);
  return names;
}

/** `/owner/log?type=…&staff=…&date=YYYY-MM-DD` (link trong tin Telegram dùng `?action=`). */
export function LogPage() {
  const { client } = useOwner();
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
  const select = 'input px-3';

  return (
    <OwnerLayout title="Nhật ký" back="/owner" testId="log-page">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select className={select} value={type} onChange={(e) => set('type', e.target.value)} data-testid="log-filter-type" aria-label="Loại">
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
        </select>
        <select className={select} value={staffId} onChange={(e) => set('staff', e.target.value)} data-testid="log-filter-staff" aria-label="Nhân viên">
          <option value="">Mọi nhân viên</option>
          {[...(names?.staff ?? new Map<string, string>())].map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input type="date" className={select} value={date} onChange={(e) => set('date', e.target.value)} data-testid="log-filter-date" aria-label="Ngày" />
      </div>

      <ErrorText testId="log-error">{error}</ErrorText>
      {(!rows || !names) && !error && <Splash />}
      {rows && names && rows.length === 0 && (
        <p className="text-ink-subtle" data-testid="log-empty">
          Không có mục nào.
        </p>
      )}
      {rows && names && rows.length > 0 && (
        <ol className="flex flex-col divide-y divide-line overflow-hidden card" data-testid="log-list">
          {rows.map((e) => (
            <LogRow key={e.id} e={e} names={names} />
          ))}
        </ol>
      )}
      {more && (
        <button type="button" className="btn btn-secondary" onClick={() => void loadMore()} data-testid="log-more">
          Xem thêm
        </button>
      )}
    </OwnerLayout>
  );
}

function LogRow({ e, names }: { e: AuditEntry; names: LogNames }) {
  const lines = describeAudit(e, { customer: (id) => names.customers.get(id) ?? id });
  const code = (e.after as { code?: string } | null)?.code ?? (e.before as { code?: string } | null)?.code;
  const tablet = e.tablet_profile_id ? names.tablets.get(e.tablet_profile_id) : null;
  const alert = e.action === 'order_delete' || e.action === 'seq_gap' || e.action === 'sync_rejected' || e.action === 'owner_edit_order';
  return (
    <li className="flex flex-col gap-1 px-4 py-3" data-testid="log-row" data-action={e.action} data-entity={e.entity_id ?? ''}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className={`font-semibold ${alert ? 'text-danger-strong' : ''}`} data-testid="log-row-title">
          {actionLabel(e.action)}
          {code && e.entity === 'order' && (
            <>
              {' '}
              <Link to={`/owner/orders/${e.entity_id}`} className="underline" data-testid="log-row-order">
                Đơn #<span className="font-mono">{code}</span>
              </Link>
            </>
          )}
        </span>
        <span className="text-sm text-ink-subtle">{when(e)}</span>
      </p>
      <p className="text-sm text-ink-muted" data-testid="log-row-actor">
        {actor(e, names)}
        {tablet ? ` – ${tablet}` : ''}
      </p>
      {lines.map((l, i) => (
        <p key={i} className="text-base" data-testid="log-row-line">
          {l}
        </p>
      ))}
    </li>
  );
}
