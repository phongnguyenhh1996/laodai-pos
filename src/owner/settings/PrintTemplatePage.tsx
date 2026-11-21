import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useIsTablet } from '@/app/useMediaQuery';
import { ErrorText, Splash, errorMessage } from '@/app/ui';
import { layoutBill, layoutKitchen, sampleDoc } from '@/print/layout';
import type { Line, PrintTemplate } from '@/print/types';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { RemotePrint, loadPrintTemplate, savePrintTemplate } from '../print/RemotePrint';
import { CheckMark, FormInput, Note, Section, btn } from '../ui';

/**
 * Cài đặt → Mẫu in (SPEC 12.5): một mẫu chung cho phiếu bếp + bill. Bật / tắt từng dòng, chữ tự nhập, cỡ mã đơn;
 * xem trước là CHÍNH ảnh gửi sang máy in (vẽ bằng render.ts với đơn mẫu); In thử tại chỗ hoặc gửi tới một quầy.
 * Luôn in, không tắt được: mã đơn, món + số lượng, Tổng (bill), "ĐÃ SỬA" + giờ sửa (phiếu bếp).
 */

const BILL_LINES: Array<[keyof PrintTemplate['bill'], string]> = [
  ['shop_name', 'Tên quán'],
  ['point', 'Điểm bán'],
  ['phone', 'Số điện thoại'],
  ['address', 'Địa chỉ'],
  ['time', 'Giờ thanh toán'],
  ['dine', 'Tại chỗ / Mang về'],
  ['label', 'Nhãn hoặc bàn'],
  ['unit_price', 'Đơn giá (SL > 1)'],
  ['thanks', '“Cảm ơn quý khách”'],
  ['no_bill_free', '“Không có bill = miễn phí”'],
];

const KITCHEN_LINES: Array<[keyof PrintTemplate['kitchen'], string]> = [
  ['queue_no', 'Số thứ tự hàng đợi'],
  ['dine', 'Tại chỗ / Mang về'],
  ['label', 'Nhãn hoặc bàn'],
  ['time', 'Giờ tạo đơn'],
  ['toppings', 'Topping'],
];

export function PrintTemplatePage() {
  const { client } = useOwner();
  const isTablet = useIsTablet();
  const [t, setT] = useState<PrintTemplate | null>(null);
  const [saved, setSaved] = useState<PrintTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadPrintTemplate(client)
      .then((x) => {
        if (!alive) return;
        setT(x);
        setSaved(x);
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client]);

  const dirty = t && saved && JSON.stringify(t) !== JSON.stringify(saved);

  async function save() {
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      const x = await savePrintTemplate(client, { ...t, footer: t.footer.map((f) => f.trim()).filter(Boolean) });
      setT(x);
      setSaved(x);
      setFlash('Đã lưu mẫu in');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const saveBtn = (
    <button type="button" className={btn('brand', isTablet ? '' : 'min-h-[45px] flex-1 text-[15px]')} disabled={busy || !dirty} onClick={() => void save()} data-testid="print-template-save">
      <Check aria-hidden className="h-[17px] w-[17px]" />
      {busy ? 'Đang lưu…' : 'Lưu mẫu in'}
    </button>
  );

  const footer = t ? [0, 1, 2].map((i) => t.footer[i] ?? '') : [];

  const body = t && (
    <>
      <Section title="Thông tin quán" testId="tpl-shop">
        <div className="flex flex-col gap-3.5">
          <FormInput label="Tên quán" value={t.shop_name} maxLength={40} onChange={(e) => setT({ ...t, shop_name: e.target.value })} data-testid="tpl-shop-name" />
          <div className="grid grid-cols-2 gap-2.5">
            <FormInput
              label="Số điện thoại"
              value={t.phone}
              maxLength={20}
              inputMode="tel"
              placeholder="09xx xxx xxx"
              onChange={(e) => setT({ ...t, phone: e.target.value })}
              data-testid="tpl-phone"
            />
            <FormInput label="Địa chỉ" value={t.address} maxLength={80} placeholder="Số nhà, đường" onChange={(e) => setT({ ...t, address: e.target.value })} data-testid="tpl-address" />
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium leading-4 text-[#6d6d6d]">Chân trang (3 dòng)</legend>
            <div className="flex flex-col gap-2">
              {footer.map((f, i) => (
                <FormInput
                  key={i}
                  label={`Chân trang dòng ${i + 1}`}
                  srLabel
                  value={f}
                  maxLength={48}
                  placeholder={`Dòng ${i + 1}`}
                  onChange={(e) => {
                    const next = [...footer];
                    next[i] = e.target.value;
                    setT({ ...t, footer: next });
                  }}
                  data-testid={`tpl-footer-${i}`}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </Section>

      <Section title="Cỡ chữ mã đơn">
        <div role="radiogroup" aria-label="Cỡ chữ mã đơn" className="grid grid-cols-2 gap-1 rounded-xl bg-[#efefef] p-1">
          {(['large', 'xlarge'] as const).map((c) => {
            const on = t.code_size === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-pressed={on}
                className={`h-8 rounded-[9px] text-[13px] leading-4 transition-colors duration-fast ${on ? 'bg-white font-semibold text-[#c2380a] shadow-sm' : 'font-medium text-[#6d6d6d] hover:text-[#111]'}`}
                onClick={() => setT({ ...t, code_size: c })}
                data-testid={`tpl-code-${c}`}
              >
                {c === 'large' ? 'To' : 'Rất to'}
              </button>
            );
          })}
        </div>
      </Section>

      <Toggles title="Dòng trên bill" items={BILL_LINES} values={t.bill} onChange={(k, v) => setT({ ...t, bill: { ...t.bill, [k]: v } })} prefix="tpl-bill" />
      <Toggles title="Dòng trên phiếu bếp" items={KITCHEN_LINES} values={t.kitchen} onChange={(k, v) => setT({ ...t, kitchen: { ...t.kitchen, [k]: v } })} prefix="tpl-kitchen" />
    </>
  );

  const preview = t && (
    <Section title="Xem trước · đơn mẫu" subtitle="Khổ 58mm" testId="tpl-preview">
      <div className="grid grid-cols-2 items-start gap-3 rounded-xl bg-[#f8f8f8] p-3">
        <Preview title="Phiếu bếp" lines={layoutKitchen({ doc: sampleDoc(), template: t, queueNo: 3 })} testId="tpl-preview-kitchen" />
        <Preview title="Bill" lines={layoutBill({ doc: sampleDoc(), template: t })} testId="tpl-preview-bill" />
      </div>
      <RemotePrint client={client} kind="test" orderId={null} defaultProfileId={null} label="In thử" optionPrefix="In tại: " testId="tpl-test-print" />
      {dirty && <p className="text-xs leading-[17px] text-[#a16207]">In thử dùng mẫu đã lưu: bấm “Lưu mẫu in” trước.</p>}
    </Section>
  );

  const always = (
    <Note tone="gray">Luôn in: mã đơn, món + số lượng, Tổng (bill), “ĐÃ SỬA” kèm giờ sửa (phiếu bếp). Bill không bao giờ in hình thức thanh toán, tiền khách đưa, nợ, tên nhân viên.</Note>
  );

  return (
    <OwnerLayout
      title="Mẫu in"
      subtitle={isTablet ? 'Phiếu bếp + bill · khổ 58mm' : undefined}
      actions={isTablet && t ? saveBtn : undefined}
      bottomBar={!isTablet && t ? saveBtn : undefined}
      back="/owner/settings"
      wide
      testId="print-template"
    >
      <ErrorText testId="print-template-error">{error}</ErrorText>
      {!t && !error && <Splash />}
      {flash && !dirty && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-[#e8f7ee] px-3.5 py-3 text-[13px] font-medium leading-4 text-[#15803d]" data-testid="print-template-flash">
          <Check aria-hidden className="h-4 w-4 shrink-0" />
          {flash}
        </p>
      )}
      {t &&
        (isTablet ? (
          <div className="grid grid-cols-2 items-start gap-5">
            <div className="flex flex-col gap-4">{body}</div>
            <div className="sticky top-[108px] flex flex-col gap-4">
              {preview}
              {always}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {preview}
            {body}
            {always}
          </div>
        ))}
    </OwnerLayout>
  );
}

function Toggles<K extends string>({
  title,
  items,
  values,
  onChange,
  prefix,
}: {
  title: string;
  items: Array<[K, string]>;
  values: Record<K, boolean>;
  onChange: (k: K, v: boolean) => void;
  prefix: string;
}) {
  return (
    <Section title={title}>
      <div className="-mb-2 grid grid-cols-2 gap-x-2.5">
        {items.map(([k, label]) => (
          <label key={k} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] font-medium leading-4 md:gap-3 md:text-sm md:leading-[18px]">
            <CheckMark checked={values[k]} onChange={(e) => onChange(k, e.target.checked)} data-testid={`${prefix}-${k}`} />
            <span className="min-w-0">{label}</span>
          </label>
        ))}
      </div>
    </Section>
  );
}

/** Xem trước = ảnh vẽ bằng đúng hàm gửi sang máy in. Trình duyệt không có canvas (test) ⇒ hiện chữ. */
function Preview({ title, lines, testId }: { title: string; lines: Line[]; testId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const key = JSON.stringify(lines);
  useEffect(() => {
    let alive = true;
    import('@/print/render')
      .then(async ({ renderTicket, monoToCanvas }) => ({ canvas: monoToCanvas((await renderTicket(lines)).image) }))
      .then(({ canvas }) => {
        if (!alive || !box.current) return;
        canvas.style.width = '100%';
        canvas.style.imageRendering = 'pixelated';
        box.current.replaceChildren(canvas);
      })
      .catch(() => alive && setFallback(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <figure className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line bg-white px-2 pb-2 pt-2.5">
      <figcaption className="text-center text-[10px] font-semibold uppercase leading-[13px] text-[#888]">{title}</figcaption>
      <div className="mx-auto w-full max-w-[384px]" data-testid={testId} data-text={lines.map((l) => ('text' in l ? l.text : 'left' in l ? `${l.left} ${l.right}` : '')).join('\n')}>
        <div ref={box} />
        {fallback && (
          <pre className="whitespace-pre-wrap font-mono text-[10px] text-black">{lines.map((l) => ('text' in l ? l.text : 'left' in l ? `${l.left}  ${l.right}` : '────────')).join('\n')}</pre>
        )}
      </div>
    </figure>
  );
}
