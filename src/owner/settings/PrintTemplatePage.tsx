import { useEffect, useRef, useState } from 'react';
import { ErrorText, Splash, TextField, errorMessage } from '@/app/ui';
import { layoutBill, layoutKitchen, sampleDoc } from '@/print/layout';
import type { Line, PrintTemplate } from '@/print/types';
import { useOwner } from '../OwnerContext';
import { OwnerLayout } from '../OwnerLayout';
import { RemotePrint, loadPrintTemplate, savePrintTemplate } from '../print/RemotePrint';

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
  ['unit_price', 'Đơn giá (món số lượng > 1)'],
  ['thanks', '“Cảm ơn quý khách!”'],
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

  const footer = t ? [0, 1, 2].map((i) => t.footer[i] ?? '') : [];

  return (
    <OwnerLayout title="Mẫu in" back="/owner/settings" testId="print-template">
      <ErrorText testId="print-template-error">{error}</ErrorText>
      {!t && !error && <Splash />}
      {t && (
        <>
          <section className="card flex flex-col gap-3 p-4">
            <h2 className="text-lg font-bold">Thông tin quán</h2>
            <TextField label="Tên quán" value={t.shop_name} maxLength={40} onChange={(e) => setT({ ...t, shop_name: e.target.value })} data-testid="tpl-shop-name" />
            <TextField label="Số điện thoại" value={t.phone} maxLength={20} inputMode="tel" onChange={(e) => setT({ ...t, phone: e.target.value })} data-testid="tpl-phone" />
            <TextField label="Địa chỉ" value={t.address} maxLength={80} onChange={(e) => setT({ ...t, address: e.target.value })} data-testid="tpl-address" />
            {footer.map((f, i) => (
              <TextField
                key={i}
                label={`Chân trang dòng ${i + 1}`}
                value={f}
                maxLength={48}
                onChange={(e) => {
                  const next = [...footer];
                  next[i] = e.target.value;
                  setT({ ...t, footer: next });
                }}
                data-testid={`tpl-footer-${i}`}
              />
            ))}
            <div className="flex flex-col gap-1.5">
              <span className="field-label">Cỡ chữ mã đơn</span>
              <div className="flex gap-2">
                {(['large', 'xlarge'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="btn btn-segment flex-1"
                    aria-pressed={t.code_size === c}
                    onClick={() => setT({ ...t, code_size: c })}
                    data-testid={`tpl-code-${c}`}
                  >
                    {c === 'large' ? 'To' : 'Rất to'}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <Toggles title="Dòng trên bill" items={BILL_LINES} values={t.bill} onChange={(k, v) => setT({ ...t, bill: { ...t.bill, [k]: v } })} prefix="tpl-bill" />
          <Toggles
            title="Dòng trên phiếu bếp"
            items={KITCHEN_LINES}
            values={t.kitchen}
            onChange={(k, v) => setT({ ...t, kitchen: { ...t.kitchen, [k]: v } })}
            prefix="tpl-kitchen"
          />
          <p className="text-sm text-ink-subtle">Luôn in: mã đơn, món + số lượng, Tổng (bill), “ĐÃ SỬA” kèm giờ sửa (phiếu bếp). Bill không bao giờ in hình thức thanh toán, tiền khách đưa, nợ, tên nhân viên.</p>

          {flash && !dirty && (
            <p role="status" className="text-base font-medium text-success-strong" data-testid="print-template-flash">
              {flash}
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()} data-testid="print-template-save">
            Lưu mẫu in
          </button>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Xem trước (đơn mẫu)</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Preview title="Phiếu bếp" lines={layoutKitchen({ doc: sampleDoc(), template: t, queueNo: 3 })} testId="tpl-preview-kitchen" />
              <Preview title="Bill" lines={layoutBill({ doc: sampleDoc(), template: t })} testId="tpl-preview-bill" />
            </div>
          </section>

          <h2 className="text-lg font-bold">In thử</h2>
          {dirty && <p className="text-sm text-warning-strong">In thử dùng mẫu đã lưu: bấm “Lưu mẫu in” trước.</p>}
          <RemotePrint client={client} kind="test" orderId={null} defaultProfileId={null} label="In thử" testId="tpl-test-print" />
        </>
      )}
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
    <section className="card flex flex-col gap-1 p-4">
      <h2 className="mb-1 text-lg font-bold">{title}</h2>
      {items.map(([k, label]) => (
        <label key={k} className="flex min-h-tap items-center gap-3 text-lg">
          <input type="checkbox" className="h-6 w-6 accent-brand-strong" checked={values[k]} onChange={(e) => onChange(k, e.target.checked)} data-testid={`${prefix}-${k}`} />
          {label}
        </label>
      ))}
    </section>
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
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-ink-subtle">{title} · khổ 58mm</figcaption>
      <div className="mx-auto w-full max-w-[384px] rounded-lg border border-line bg-white p-2 shadow-xs" data-testid={testId} data-text={lines.map((l) => ('text' in l ? l.text : 'left' in l ? `${l.left} ${l.right}` : '')).join('\n')}>
        <div ref={box} />
        {fallback && <pre className="whitespace-pre-wrap font-mono text-xs text-black">{lines.map((l) => ('text' in l ? l.text : 'left' in l ? `${l.left}  ${l.right}` : '────────')).join('\n')}</pre>}
      </div>
    </figure>
  );
}
