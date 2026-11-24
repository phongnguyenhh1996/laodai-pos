import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Boxes, Check, ChevronRight, Layers, ListChecks, MapPin, Plus, Printer, Store, Users, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { useIsTablet } from '@/app/useMediaQuery';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { parseCountInput } from '@/domain/catalog';
import { MoneyInput } from '@/app/MoneyInput';
import { formatVnd } from '@/domain/money';
import { TZ } from '@/domain/time';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { CheckMark, FormInput, FormSelect, IconTile, Note, PageHead, Section, Switch, TONE, btn, card, type Tone } from '../ui';
import { loadOwnerCatalog, loadPriceHistory, saveSetting, saveStaffDetails, type OwnerCatalog, type PriceChange } from './api';
import { PrintTemplatePage } from './PrintTemplatePage';
import { entityByKey, type EntityDef, type FieldDef, type Form, type FormValue } from './entities';

/** `/owner/settings/*` (mục 7, màn chủ số 7; Figma R31–R33 / T32–T34). */
export function SettingsRoutes() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path="print-template" element={<PrintTemplatePage />} />
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

/** Icon + màu + dòng mô tả của từng mục (Figma R31). */
const VISUAL: Record<string, { icon: LucideIcon; tone: Tone; desc: (cat: OwnerCatalog | null) => string }> = {
  products: { icon: UtensilsCrossed, tone: 'orange', desc: () => 'Tên, giá, đang bán' },
  toppings: { icon: Layers, tone: 'orange', desc: () => 'Giá thêm theo món' },
  combos: { icon: Boxes, tone: 'orange', desc: () => 'Món chính + topping kèm' },
  menus: { icon: ListChecks, tone: 'orange', desc: () => 'Món hiện ở từng điểm bán' },
  points: { icon: MapPin, tone: 'blue', desc: (c) => names(c?.points.filter((p) => p.active)) || 'Nơi bán, mỗi nơi một menu' },
  profiles: { icon: Store, tone: 'blue', desc: (c) => names(c?.profiles) || 'Máy bán hàng và điểm bán của nó' },
  staff: { icon: Users, tone: 'green', desc: () => 'CCCD, sinh nhật, lương ngày' },
  'print-template': { icon: Printer, tone: 'gray', desc: () => 'Phiếu bếp + bill, xem trước, in thử' },
};
const names = (rows: Array<{ name: string }> | undefined) => (rows ?? []).map((r) => r.name).join(' · ');

const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: 'Bán hàng', keys: ['products', 'toppings', 'combos', 'menus'] },
  { title: 'Cửa hàng', keys: ['points', 'profiles', 'staff', 'print-template'] },
];

// ---------------------------------------------------------------- trang đầu (R31 / T32)

function SettingsHome() {
  const isTablet = useIsTablet();
  const { cat } = useOwnerCatalog(); // chỉ để hiện tên điểm bán / quầy: lỗi thì bỏ qua
  const subtitle = 'Thay đổi tự đồng bộ về các máy bán hàng';
  const note = (
    <Note testId="settings-note">
      Không có xóa: món, topping, combo ngừng bán hoặc nhân viên nghỉ thì bỏ chọn “Đang bán” / “Đang làm”. Máy bán hàng nhận thay đổi ở lần đồng bộ kế tiếp (mở lại màn bán hàng, có mạng lại, hoặc sau
      vài phút).
    </Note>
  );
  const group = (g: (typeof GROUPS)[number]) => (
    <div key={g.title} className="flex flex-col gap-3.5">
      <h2 className="text-xs font-semibold uppercase leading-[15px] tracking-normal text-[#888]">{g.title}</h2>
      <nav className={`${card} overflow-hidden`} aria-label={g.title}>
        {g.keys.map((key, i) => {
          const v = VISUAL[key];
          const def = entityByKey(key);
          return <MenuRow key={key} to={`${SETTINGS}/${key}`} testId={`settings-section-${key}`} icon={v.icon} tone={v.tone} title={def?.title ?? 'Mẫu in'} subtitle={v.desc(cat)} divider={i > 0} />;
        })}
      </nav>
    </div>
  );
  return (
    <OwnerLayout title={isTablet ? 'Cài đặt quán' : 'Cài đặt'} subtitle={isTablet ? subtitle : undefined} back={isTablet ? '/owner' : '/owner/more'} tabBar wide testId="settings-home">
      {isTablet ? (
        <div className="grid grid-cols-2 items-start gap-5">
          <div className="flex flex-col gap-4">
            {group(GROUPS[0])}
            {note}
          </div>
          {group(GROUPS[1])}
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <PageHead title="Cài đặt quán" subtitle={subtitle} />
          {GROUPS.map(group)}
          {note}
        </div>
      )}
    </OwnerLayout>
  );
}

/** Dòng trong thẻ: ô icon 38 + tên 15 đậm + dòng phụ 12 + mũi tên (Figma R31). */
function MenuRow({
  to,
  testId,
  icon,
  tone,
  title,
  subtitle,
  divider,
  muted,
  badge,
}: {
  to: string;
  testId: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  subtitle?: string;
  divider: boolean;
  muted?: boolean;
  badge?: ReactNode;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={`flex min-h-[63px] items-center gap-3 px-3.5 py-3 transition-colors duration-fast hover:bg-[#fafafa] active:bg-[#f4f4f4] ${divider ? 'border-t border-line' : ''}`}
    >
      <IconTile icon={icon} className="h-[38px] w-[38px] rounded-[11px]" iconClass="h-[19px] w-[19px]" tone={muted ? TONE.gray : TONE[tone]} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex min-w-0 items-center gap-2">
          <b className={`truncate text-[15px] font-semibold leading-[19px] ${muted ? 'text-[#888]' : ''}`}>{title}</b>
          {badge}
        </span>
        {subtitle && <span className="truncate text-xs leading-[15px] text-[#888]">{subtitle}</span>}
      </span>
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-[#888]" />
    </Link>
  );
}

// ---------------------------------------------------------------- danh sách

function EntityListRoute() {
  const def = entityByKey(useParams().entity);
  if (!def) return <Navigate to={SETTINGS} replace />;
  return <EntityList def={def} />;
}

function EntityList({ def }: { def: EntityDef }) {
  const isTablet = useIsTablet();
  const { cat, error } = useOwnerCatalog();
  const v = VISUAL[def.key];
  const rows = cat ? def.rows(cat) : [];
  const add = (
    <Link to={`${SETTINGS}/${def.key}/new`} className={btn(isTablet ? 'brand' : 'soft', isTablet ? '' : 'w-full')} data-testid="settings-new">
      <Plus aria-hidden className="h-4 w-4" />
      Thêm {def.noun}
    </Link>
  );
  return (
    <OwnerLayout
      title={def.title}
      subtitle={isTablet && cat ? `${rows.filter((r) => r.active !== false).length} đang dùng · ${rows.length} tất cả` : undefined}
      actions={isTablet ? add : undefined}
      back={SETTINGS}
      wide
      testId="settings-list"
    >
      <ErrorText testId="settings-error">{error}</ErrorText>
      {!cat && !error && <Splash />}
      {cat && (
        <div className="flex flex-col gap-3.5">
          {rows.length > 0 ? (
            <nav className={`${card} overflow-hidden`} aria-label={def.title}>
              {rows.map((r, i) => (
                <MenuRow
                  key={r.id}
                  to={`${SETTINGS}/${def.key}/${r.id}`}
                  testId={`settings-row-${r.id}`}
                  icon={v.icon}
                  tone={v.tone}
                  title={r.name}
                  subtitle={def.summary(r, cat) || undefined}
                  divider={i > 0}
                  muted={r.active === false}
                  badge={r.active === false && <span className={`shrink-0 rounded-full px-2 py-px text-[11px] font-semibold leading-[14px] ${TONE.gray}`}>Ngừng</span>}
                />
              ))}
            </nav>
          ) : (
            <p className={`${card} p-4 text-sm text-[#888]`}>Chưa có {def.noun} nào.</p>
          )}
          {!isTablet && add}
        </div>
      )}
    </OwnerLayout>
  );
}

// ---------------------------------------------------------------- sửa / thêm (R32 / T33)

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
  const row = cat && id ? def.rows(cat).find((r) => r.id === id) : null;
  if (!cat || (id && !row))
    return (
      <EditorShell def={def} id={id} name={undefined} busy={false} disabled>
        <ErrorText testId="settings-error">{error}</ErrorText>
        {!cat && !error && <Splash />}
        {cat && <ErrorText testId="settings-error">Không tìm thấy {def.noun} này.</ErrorText>}
      </EditorShell>
    );
  return <EntityForm def={def} cat={cat} id={id} row={row ?? null} saved={saved} initialError={initialError} />;
}

const FORM_ID = 'settings-form';

/** Khung trang sửa: tablet nút Hủy / Lưu ở đầu trang, điện thoại ở thanh dính đáy. */
function EditorShell({
  def,
  id,
  name,
  busy,
  disabled = false,
  children,
}: {
  def: EntityDef;
  id: string | null;
  name: string | undefined;
  busy: boolean;
  /** Chưa có form (đang tải / không tìm thấy): nút Lưu mờ. */
  disabled?: boolean;
  children: ReactNode;
}) {
  const isTablet = useIsTablet();
  const back = `${SETTINGS}/${def.key}`;
  const cancel = (
    <Link to={back} className={btn('outline', isTablet ? '' : 'min-h-[47px] flex-1 text-[15px]')} data-testid="settings-cancel">
      Hủy
    </Link>
  );
  const save = (
    <button type="submit" form={FORM_ID} className={btn('brand', isTablet ? '' : 'min-h-[45px] flex-1 text-[15px]')} disabled={busy || disabled} data-testid="settings-save">
      <Check aria-hidden className="h-[17px] w-[17px]" />
      {busy ? 'Đang lưu…' : 'Lưu'}
    </button>
  );
  return (
    <OwnerLayout
      title={id ? `Sửa ${def.noun}` : `Thêm ${def.noun}`}
      subtitle={isTablet ? name : undefined}
      actions={
        isTablet ? (
          <>
            {cancel}
            {save}
          </>
        ) : undefined
      }
      bottomBar={
        isTablet ? undefined : (
          <>
            {cancel}
            {save}
          </>
        )
      }
      back={back}
      wide
      testId="settings-editor"
    >
      {children}
    </OwnerLayout>
  );
}

interface FieldCard {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  side: boolean;
  fields: FieldDef[];
}

/** Chia ô thành thẻ: ô có `section` mở thẻ mới; các ô đầu không có ⇒ thẻ "Thông tin <noun>". */
function toCards(def: EntityDef): FieldCard[] {
  const out: FieldCard[] = [];
  for (const f of def.fields) {
    if (f.section || out.length === 0) out.push({ title: f.section ?? `Thông tin ${def.noun}`, hint: f.sectionHint, icon: f.sectionIcon, side: f.side === true, fields: [] });
    out[out.length - 1].fields.push(f);
  }
  return out;
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
  const isTablet = useIsTablet();
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
  const cards = toCards(def);
  const renderCard = (c: FieldCard) => (
    <Section key={c.title} title={c.title} subtitle={c.hint} right={c.icon && <IconTile icon={c.icon} className="h-[34px] w-[34px] rounded-[10px]" />} testId={`settings-card-${c.fields[0].key}`}>
      <CardFields card={c} entity={def} form={form} cat={cat} disabled={busy} isNew={id === null} onChange={set} />
    </Section>
  );
  const history = def.priceHistory && id ? <PriceHistory type={def.priceHistory} entityId={id} /> : null;
  const main = cards.filter((c) => !c.side || !isTablet);
  const side = isTablet ? cards.filter((c) => c.side) : [];

  return (
    <EditorShell def={def} id={id} name={row?.name} busy={busy}>
      <form id={FORM_ID} className="flex flex-col gap-3.5 md:gap-5" onSubmit={submit} data-testid={`settings-form-${def.key}`}>
        {saved && !dirty && (
          <p data-testid="settings-saved" role="status" className="flex items-center gap-2 rounded-xl bg-[#e8f7ee] px-3.5 py-3 text-[13px] font-medium leading-4 text-[#15803d]">
            <Check aria-hidden className="h-4 w-4 shrink-0" />
            Đã lưu. Các máy bán hàng nhận thay đổi ở lần đồng bộ kế tiếp.
          </p>
        )}
        <ErrorText testId="settings-error">{error}</ErrorText>
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-2 md:items-start md:gap-5">
          <div className="flex flex-col gap-3.5 md:gap-4">
            {main.map(renderCard)}
            {preview && (
              <p data-testid="settings-preview" className="rounded-xl bg-[#f8f8f8] px-3.5 py-3 text-[13px] leading-[19px] text-[#6d6d6d]">
                {preview}
              </p>
            )}
            {!isTablet && history}
          </div>
          {isTablet && (side.length > 0 || history) && (
            <div className="flex flex-col gap-4">
              {side.map(renderCard)}
              {history}
            </div>
          )}
        </div>
      </form>
    </EditorShell>
  );
}

/** Ô trong một thẻ: hai ô `half` liền nhau chung hàng, các công tắc liền nhau chung một danh sách có vạch ngăn. */
function CardFields({
  card: c,
  entity,
  form,
  cat,
  disabled,
  isNew,
  onChange,
}: {
  card: FieldCard;
  entity: EntityDef;
  form: Form;
  cat: OwnerCatalog;
  disabled: boolean;
  isNew: boolean;
  onChange: (key: string, v: FormValue) => void;
}) {
  const parts: FieldDef[][] = [];
  const shown = c.fields.filter((f) => !f.when || f.when(form));
  if (shown.length === 0) return <p className="text-[13px] leading-[18px] text-[#6d6d6d]">Không có gì cần nhập.</p>;
  for (const f of shown) {
    const last = parts[parts.length - 1];
    const prev = last?.[last.length - 1];
    const join = prev && ((f.kind === 'bool' && prev.kind === 'bool') || (f.half && prev.half && last.length < 2));
    if (join) last.push(f);
    else parts.push([f]);
  }
  const field = (f: FieldDef) => (
    <Field
      key={f.key}
      def={f}
      form={form}
      cat={cat}
      icon={f.key === 'name' ? VISUAL[entity.key]?.icon : undefined}
      hideLabel={f.label === c.title}
      disabled={disabled || (f.createOnly === true && !isNew)}
      onChange={onChange}
    />
  );
  return (
    <div className="flex flex-col gap-3.5">
      {parts.map((p) =>
        p[0].kind === 'bool' ? (
          <div key={p[0].key} className="-my-2 flex flex-col divide-y divide-line">
            {p.map(field)}
          </div>
        ) : p.length === 2 ? (
          <div key={p[0].key} className="grid grid-cols-2 gap-2.5">
            {p.map(field)}
          </div>
        ) : (
          <Fragment key={p[0].key}>{field(p[0])}</Fragment>
        ),
      )}
    </div>
  );
}

function Field({
  def,
  form,
  cat,
  icon,
  hideLabel,
  disabled,
  onChange,
}: {
  def: FieldDef;
  form: Form;
  cat: OwnerCatalog;
  icon?: LucideIcon;
  hideLabel: boolean;
  disabled: boolean;
  onChange: (key: string, v: FormValue) => void;
}) {
  const testId = `field-${def.key}`;
  const value = form[def.key];

  switch (def.kind) {
    case 'text':
      return (
        <FormInput
          label={def.label}
          icon={icon}
          hint={def.hint}
          value={String(value)}
          disabled={disabled}
          maxLength={60}
          inputMode={def.numeric ? 'numeric' : def.tel ? 'tel' : undefined}
          type={def.tel ? 'tel' : undefined}
          onChange={(e) => onChange(def.key, e.target.value)}
          data-testid={testId}
        />
      );
    case 'date':
      return <FormInput label={def.label} hint={def.hint} type="date" value={String(value)} disabled={disabled} onChange={(e) => onChange(def.key, e.target.value)} data-testid={testId} />;
    case 'money': {
      const vnd = parseCountInput(String(value));
      return (
        <MoneyInput
          size="owner"
          label={def.label}
          hint={def.hint}
          value={vnd}
          disabled={disabled}
          onChange={(v) => onChange(def.key, v === null ? '' : String(v))}
          testId={testId}
        />
      );
    }
    case 'count':
      return (
        <FormInput label={def.label} unit={def.unit} hint={def.hint} value={String(value)} inputMode="numeric" disabled={disabled} onChange={(e) => onChange(def.key, e.target.value)} data-testid={testId} />
      );
    case 'bool':
      return (
        <label className="flex min-h-[50px] cursor-pointer items-center justify-between gap-3 py-2">
          <span className="text-sm font-medium leading-[18px]">{def.label}</span>
          <Switch checked={value === true} disabled={disabled} onChange={(e) => onChange(def.key, e.target.checked)} data-testid={testId} />
        </label>
      );
    case 'select':
      return (
        <FormSelect label={def.label} hint={def.hint} value={String(value)} disabled={disabled} onChange={(e) => onChange(def.key, e.target.value)} data-testid={testId}>
          {def.options?.(form, cat).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FormSelect>
      );
    case 'multi': {
      const selected = Array.isArray(value) ? value : [];
      const options = def.options?.(form, cat) ?? [];
      const wide = options.some((o) => o.label.length > 12);
      return (
        <fieldset className="flex flex-col gap-1.5" data-testid={testId}>
          <legend className={hideLabel ? 'sr-only' : 'mb-1.5 text-[13px] font-medium leading-4 text-[#6d6d6d]'}>{def.label}</legend>
          {options.length === 0 && <span className="text-sm text-[#888]">Chưa có lựa chọn</span>}
          <div className={`grid gap-2 ${wide ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {options.map((o) => {
              const on = selected.includes(o.value);
              return (
                <label
                  key={o.value}
                  className={`flex min-h-[45px] cursor-pointer items-center justify-center gap-2 rounded-xl px-1.5 py-2 text-sm leading-[18px] transition-colors duration-fast ${
                    on ? 'border-[1.5px] border-brand bg-[#ffeee7] font-semibold text-[#c2380a]' : 'border border-line bg-white font-medium text-[#111] hover:bg-[#f8f8f8]'
                  } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <CheckMark
                    className="h-[18px] w-[18px] rounded-md"
                    checked={on}
                    disabled={disabled}
                    onChange={(e) => onChange(def.key, e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
                    data-testid={`${testId}-${o.value}`}
                  />
                  <span className="min-w-0">{o.label}</span>
                </label>
              );
            })}
          </div>
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
    <Section title="Lịch sử giá" subtitle="Giá mới chỉ áp dụng cho đơn tạo sau khi lưu" testId="price-history">
      <ErrorText testId="price-history-error">{error}</ErrorText>
      {rows?.length === 0 && <p className="text-sm text-[#888]">Chưa đổi giá lần nào.</p>}
      {rows && rows.length > 0 && (
        <ul className="-my-1.5 flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm leading-[18px]" data-testid="price-history-row">
              <span className="num">
                <span className="text-[#888]">{formatVnd(r.old_price)}</span> → <b className="font-semibold">{formatVnd(r.new_price)}</b>
              </span>
              <span className="num text-xs text-[#888]">{dateTime.format(new Date(r.changed_at))}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
