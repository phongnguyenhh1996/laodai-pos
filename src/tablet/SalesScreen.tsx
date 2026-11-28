import { useContext, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { OrderEditor, type OrderDone } from './OrderEditor';
import { LeaveGuardContext, type LeaveGuard } from './parts';
import { QueueStrip } from './QueueStrip';
import { useToast } from './Toast';

/**
 * Bán hàng (mục 4.2–4.4), màn chính khi có ca: hàng đợi (dải đơn) ở trên, thực đơn ở giữa, giỏ bên phải
 * (điện thoại: giỏ ở đáy). Đơn đang chọn nằm trên URL (`/?order=<id>`) để tải lại / realtime vẫn giữ đúng đơn;
 * không chọn ⇒ giỏ là đơn mới trống.
 */
export function SalesScreen() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('order');
  const toast = useToast();
  /** Tăng mỗi lần giỏ về đơn mới trống: dựng lại giỏ (bản nháp mới, id đơn mới). */
  const [newSeq, setNewSeq] = useState(0);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const paidId = useRef<string | null>(null);

  // Luật rời đơn của giỏ đang mở; menu (sidebar / ☰) cũng gọi qua đây trước khi sang màn khác.
  const leaveRef = useRef<LeaveGuard | null>(null);
  const navGuard = useContext(LeaveGuardContext);
  useEffect(() => {
    if (!navGuard) return;
    navGuard.current = (go) => (leaveRef.current ? leaveRef.current(go) : go());
    return () => {
      navGuard.current = null;
    };
  }, [navGuard]);

  const setSelected = (id: string | null) => setParams(id ? { order: id } : {}, { replace: true });
  const leave = (go: () => void) => (leaveRef.current ? leaveRef.current(go) : go());

  function onDone(r: OrderDone) {
    if (r.paidId) paidId.current = r.paidId;
    if (r.toast) toast(r.toast.text, r.toast.tone);
    setHiddenIds(new Set());
    setSelected(null);
    setNewSeq((n) => n + 1);
  }

  return (
    <main
      data-testid="sales-screen"
      className="relative grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_380px] md:grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_390px]"
    >
      <div className="row-start-1 min-w-0 md:col-start-1">
        <QueueStrip
          selectedId={selectedId}
          onSelect={(id) => leave(() => setSelected(id))}
          onDeselect={() => {
            if (selectedId) leave(() => setSelected(null));
          }}
          hiddenIds={hiddenIds}
          paidId={paidId}
        />
      </div>
      <OrderEditor
        key={selectedId ?? `new-${newSeq}`}
        orderId={selectedId}
        leaveRef={leaveRef}
        onDone={onDone}
        onClose={() => {
          // Đơn vừa lưu khi mở thanh toán trong giỏ chưa nằm trên URL ⇒ dựng lại giỏ để chắc chắn về đơn mới.
          setSelected(null);
          setNewSeq((n) => n + 1);
        }}
        hideCard={(id) => setHiddenIds(id ? new Set([id]) : new Set())}
      />
    </main>
  );
}
