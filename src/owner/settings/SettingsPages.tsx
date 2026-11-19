import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { TZ } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { NavItem, NavList, OwnerLayout } from '../OwnerLayout';
import { loadOwnerCatalog, loadPriceHistory, saveSetting, saveStaffDetails, type OwnerCatalog, type PriceChange } from './api';
import { ENTITIES, entityByKey, type EntityDef, type FieldDef, type Form, type FormValue } from './entities';

/** `/owner/settings/*` (mục 7, màn chủ số 7). */
export function SettingsRoutes() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path=":entity" element={<EntityListRoute />} />
      <Route path=":entity/:id" element={<EditorRoute />} />
    </Routes>
  );
}

const SETTINGS = '/owner/settings';

function useOwnerCatalog(): { cat: OwnerCatalog | null; error: string | null } {
  const { client } = useOwner();
  const [state, setState] = useState<{ cat: OwnerCatalog | null; error: string | null }>({ cat: null, error: null });
  useEffect(() => {
    let alive = true;
    loadOwnerCatalog(client)
      .then((cat) => alive && setState({ cat, error: null }))
      .catch((e: unknown) => alive && setState({ cat: null, error: errorMessage(e) }));
    return () => {
      alive = false;
    };
  }, [client]);
  return state;
}

// ---------------------------------------------------------------- trang đầu

function SettingsHome() {
  return (
    <OwnerLayout title="Cài đặt" back="/owner" testId="settings-home">
      <NavList>
        {ENTITIES.map((e) => (
          <NavItem key={e.key} to={`${SETTINGS}/${e.key}`} testId={`settings-section-${e.key}`} title={e.title} />
        ))}
      </NavList>
      <p className="text-sm text-ink-subtle">
        Không có xóa: món, topping, combo ngừng bán hoặc nhân viên nghỉ thì bỏ chọn “Đang bán” / “Đang làm”. Các máy bán hàng nhận thay đổi ở lần
        đồng bộ kế tiếp (khi mở lại màn bán hàng, khi có mạng lại, hoặc sau vài phút).
      </p>
    </OwnerLayout>
  );
}

// ---------------------------------------------------------------- danh sách

function EntityListRoute() {
  const def = entityByKey(useParams().entity);
  if (!def) return <Navigate to={SETTINGS} replace />;
  return <EntityList def={def} />;
}

function EntityList({ def }: { def: EntityDef }) {
  const { cat, error } = useOwnerCatalog();
  return (
    <OwnerLayout title={def.title} back={SETTINGS} testId="settings-list">
      <ErrorText testId="settings-error">{error}</ErrorText>
      {!cat && !error && <Splash />}
      {cat && (
        <>
          <NavList>
            {def.rows(cat).map((r) => (
              <NavItem
                key={r.id}
                to={`${SETTINGS}/${def.key}/${r.id}`}
                testId={`settings-row-${r.id}`}
                title={r.active === false ? `${r.name} (ngừng)` : r.name}
                subtitle={def.summary(r, cat) || undefined}
                muted={r.active === false}
              />
            ))}
          </NavList>
          <NavList>
            <NavItem to={`${SETTINGS}/${def.key}/new`} testId="settings-new" title={`+ Thêm ${def.noun}`} />
          </NavList>
        </>
      )}
    </OwnerLayout>
  );
}

// ---------------------------------------------------------------- sửa / thêm

function EditorRoute() {
  const { entity, id } = useParams();
  const loc = useLocation();
  const def = entityByKey(entity);
  if (!def || !id) return <Navigate to={SETTINGS} replace />;
  // Mỗi lần lưu xong điều hướng lại chính trang này ⇒ tải lại dữ liệu (kể cả lịch sử giá).
  const state = loc.state as { saved?: boolean; error?: string } | null;
  return <EditorLoader key={loc.key} def={def} id={id === 'new' ? null : id} saved={state?.saved === true} initialError={state?.error ?? null} />;
}

function EditorLoader({ def, id, saved, initialError }: { def: EntityDef; id: string | null; saved: boolean; initialError: string | null }) {
  const { cat, error } = useOwnerCatalog();
  const title = id ? `Sửa ${def.noun}` : `Thêm ${def.noun}`;
  const back = `${SETTINGS}/${def.key}`;
  const row = cat && id ? def.rows(cat).find((r) => r.id === id) : null;
  return (
    <OwnerLayout title={title} back={back} testId="settings-editor">
      <ErrorText testId="settings-error">{error}</ErrorText>
      {!cat && !error && <Splash />}
      {cat && id && !row && <ErrorText testId="settings-error">Không tìm thấy {def.noun} này.</ErrorText>}
      {cat && (!id || row) && <EntityForm def={def} cat={cat} id={id} row={row ?? null} saved={saved} initialError={initialError} />}
    </OwnerLayout>
  );
}

function EntityForm({
  def,
  cat,
  id,
  row,
  saved,
  initialError,
}: {
  def: EntityDef;
  cat: OwnerCatalog;
  id: string | null;
  row: Parameters<EntityDef['toForm']>[0];
  saved: boolean;
  initialError: string | null;
}) {
  const { client } = useOwner();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(() => def.toForm(row, cat));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [dirty, setDirty] = useState(false);

  const set = (key: string, value: FormValue) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setError(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let values: Record<string, unknown>;
    let details: ReturnType<NonNullable<EntityDef['details']>> = null;
    try {
      values = def.fromForm(form, cat, id);
      details = def.details?.(form, cat, id) ?? null;
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    setBusy(true);
    let savedId = id;
    try {
      savedId = await saveSetting(client, def.table, id, values);
      if (details) await saveStaffDetails(client, savedId, details);
      navigate(`${SETTINGS}/${def.key}/${savedId}`, { replace: true, state: { saved: true } });
    } catch (err) {
      // Đã tạo nhân viên nhưng chưa lưu được phần thông tin riêng: sang trang sửa của nhân viên vừa tạo để lưu lại.
      if (!id && savedId) navigate(`${SETTINGS}/${def.key}/${savedId}`, { replace: true, state: { error: errorMessage(err) } });
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const preview = def.preview?.(form, cat);

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} data-testid={`settings-form-${def.key}`}>
      {saved && !dirty && (
        <p data-testid="settings-saved" role="status" className="rounded-lg bg-success-soft px-4 py-3 text-success-strong">
          Đã lưu. Các máy bán hàng nhận thay đổi ở lần đồng bộ kế tiếp.
        </p>
      )}
      {def.fields.map((f) => (
        <div key={f.key} className="contents">
          {f.section && <h2 className="mt-2 border-t border-line pt-4 text-lg font-semibold">{f.section}</h2>}
          <Field def={f} form={form} cat={cat} disabled={busy || (f.createOnly === true && id !== null)} onChange={set} />
        </div>
      ))}
      {preview && (
        <p data-testid="settings-preview" className="rounded-lg bg-surface-sunken px-4 py-3 text-ink">
          {preview}
        </p>
      )}
      <ErrorText testId="settings-error">{error}</ErrorText>
      <button type="submit" className="btn btn-primary" disabled={busy} data-testid="settings-save">
        {busy ? 'Đang lưu…' : 'Lưu'}
      </button>
      {def.priceHistory && id && <PriceHistory type={def.priceHistory} entityId={id} />}
    </form>
  );
}

function Field({
  def,
  form,
  cat,
  disabled,
  onChange,
}: {
  def: FieldDef;
  form: Form;
  cat: OwnerCatalog;
  disabled: boolean;
  onChange: (key: string, v: FormValue) => void;
}) {
  const testId = `field-${def.key}`;
  const value = form[def.key];
  const hint = def.hint && <span className="text-sm text-ink-subtle">{def.hint}</span>;

  switch (def.kind) {
    case 'text':
      return (
        <div className="flex flex-col gap-1">
          <TextField
            label={def.label}
            value={String(value)}
            disabled={disabled}
            maxLength={60}
            inputMode={def.numeric ? 'numeric' : def.tel ? 'tel' : undefined}
            type={def.tel ? 'tel' : undefined}
            onChange={(e) => onChange(def.key, e.target.value)}
            data-testid={testId}
          />
          {hint}
        </div>
      );
    case 'date':
      return (
        <div className="flex flex-col gap-1">
          <TextField label={def.label} type="date" value={String(value)} disabled={disabled} onChange={(e) => onChange(def.key, e.target.value)} data-testid={testId} />
          {hint}
        </div>
      );
    case 'money':
    case 'count': {
      const parsed = def.kind === 'money' ? parseMoneyInput(String(value)) : null;
      return (
        <div className="flex flex-col gap-1">
          <TextField
            label={def.label}
            value={String(value)}
            inputMode="numeric"
            disabled={disabled}
            onChange={(e) => onChange(def.key, e.target.value)}
            data-testid={testId}
          />
          {parsed !== null && String(value).trim() !== String(parsed) && (
            <span className="text-sm text-ink-muted" data-testid={`${testId}-parsed`}>
              = {formatVnd(parsed)}
            </span>
          )}
          {hint}
        </div>
      );
    }
    case 'bool':
      return (
        <label className="flex min-h-tap items-center gap-3 text-lg">
          <input
            type="checkbox"
            className="h-6 w-6 accent-brand-strong"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(def.key, e.target.checked)}
            data-testid={testId}
          />
          {def.label}
        </label>
      );
    case 'select':
      return (
        <label className="flex flex-col gap-1">
          <span className="text-base font-medium text-ink-muted">{def.label}</span>
          <select
            className="input px-3"
            value={String(value)}
            disabled={disabled}
            onChange={(e) => onChange(def.key, e.target.value)}
            data-testid={testId}
          >
            {def.options?.(form, cat).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {hint}
        </label>
      );
    case 'multi': {
      const selected = Array.isArray(value) ? value : [];
      const options = def.options?.(form, cat) ?? [];
      return (
        <fieldset className="flex flex-col gap-1" data-testid={testId}>
          <legend className="mb-1 text-base font-medium text-ink-muted">{def.label}</legend>
          {options.length === 0 && <span className="text-ink-subtle">Chưa có lựa chọn</span>}
          {options.map((o) => (
            <label key={o.value} className="flex min-h-tap items-center gap-3 rounded-lg px-1 text-lg">
              <input
                type="checkbox"
                className="h-6 w-6 accent-brand-strong"
                checked={selected.includes(o.value)}
                disabled={disabled}
                onChange={(e) =>
                  onChange(def.key, e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))
                }
                data-testid={`${testId}-${o.value}`}
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      );
    }
  }
}

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function PriceHistory({ type, entityId }: { type: 'product' | 'topping'; entityId: string }) {
  const { client } = useOwner();
  const [rows, setRows] = useState<PriceChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadPriceHistory(client, type, entityId)
      .then((r) => alive && setRows(r))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client, type, entityId]);

  return (
    <section className="mt-2 flex flex-col gap-2" data-testid="price-history">
      <h2 className="text-lg font-semibold">Lịch sử giá</h2>
      <ErrorText testId="price-history-error">{error}</ErrorText>
      {rows?.length === 0 && <p className="text-ink-subtle">Chưa đổi giá lần nào.</p>}
      <ul className="flex flex-col divide-y divide-line card">
        {rows?.map((r) => (
          <li key={r.id} className="flex justify-between gap-3 px-4 py-2" data-testid="price-history-row">
            <span>
              {formatVnd(r.old_price)} → <strong>{formatVnd(r.new_price)}</strong>
            </span>
            <span className="text-ink-subtle">{dateTime.format(new Date(r.changed_at))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
