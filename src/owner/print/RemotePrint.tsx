import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CircleCheckBig, Clock, LoaderCircle, Printer as PrinterIcon, TriangleAlert } from 'lucide-react';
import { errorMessage } from '@/app/ui';
import { listTabletProfiles, type TabletProfileOption } from '@/lib/auth';
import { printService } from '@/lib/print';
import { normalizeTemplate, type PrintKind, type PrintTemplate } from '@/print/types';
import { supabasePrintApi, type JobStatus, type PrintJob } from '@/print/service';
import { SelectBox, btn } from '../ui';

/** Lệnh in quá 2 phút chưa ai nhận là hết hạn (server cũng tự đổi, không bao giờ in muộn). */
export const JOB_TTL_MS = 2 * 60_000;

export async function loadPrintTemplate(client: SupabaseClient): Promise<PrintTemplate> {
  const { data, error } = await client.from('print_template').select('template').limit(1);
  if (error) throw new Error(`Không tải được mẫu in: ${error.message}`);
  return normalizeTemplate((data?.[0] as { template?: Partial<PrintTemplate> } | undefined)?.template);
}

export async function savePrintTemplate(client: SupabaseClient, t: PrintTemplate): Promise<PrintTemplate> {
  const { data, error } = await client.rpc('owner_set_print_template', { p_template: t });
  if (error) throw new Error(error.message);
  return normalizeTemplate(data as Partial<PrintTemplate>);
}

/** Trạng thái hiển thị (lệnh còn `pending` quá 2 phút ⇒ coi như hết hạn ngay, không chờ cron). */
export function shownStatus(job: Pick<PrintJob, 'status' | 'created_at'>, now = Date.now()): JobStatus {
  if (job.status === 'pending' && now - new Date(job.created_at).getTime() > JOB_TTL_MS) return 'expired';
  return job.status;
}

/** Theo dõi một lệnh in theo thời gian thực (Realtime + hỏi lại mỗi 5 giây phòng khi kênh rớt). */
export function useJob(client: SupabaseClient, jobId: string | null): PrintJob | null {
  const [job, setJob] = useState<PrintJob | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const load = async () => {
      const { data } = await client.from('print_jobs').select('*').eq('id', jobId).limit(1);
      if (alive && data?.[0]) setJob(data[0] as PrintJob);
    };
    void load();
    const ch = client
      .channel(`owner-print-job-${jobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'print_jobs', filter: `id=eq.${jobId}` }, (m) => {
        if (alive) setJob(m.new as PrintJob);
      })
      .subscribe();
    const t = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
      void client.removeChannel(ch);
    };
  }, [client, jobId]);
  void now;
  return job;
}

const KIND_LABEL: Record<PrintKind, string> = { kitchen: 'phiếu bếp', bill: 'bill', test: 'phiếu in thử' };

export function JobStatusLine({ job, testId, place }: { job: PrintJob; testId: string; place?: string | null }) {
  const s = shownStatus(job);
  const name = place ?? job.tablet_name;
  const where = name ? ` tại ${name}` : '';
  const map: Record<JobStatus, { cls: string; icon: JSX.Element; text: string }> = {
    pending: { cls: 'border-line bg-surface-sunken text-ink', icon: <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />, text: `Đang chờ máy in${where} nhận lệnh…` },
    claimed: { cls: 'border-line bg-surface-sunken text-ink', icon: <PrinterIcon className="h-4 w-4" />, text: `Đang in${where}…` },
    printed: { cls: 'border-success-line bg-success-soft text-success-strong', icon: <CircleCheckBig className="h-4 w-4" />, text: `Đã in ${KIND_LABEL[job.kind]}${where}` },
    failed: { cls: 'border-danger-line bg-danger-soft text-danger-strong', icon: <TriangleAlert className="h-4 w-4" />, text: `In lỗi${where}: ${job.error ?? 'không rõ lý do'}` },
    expired: { cls: 'border-warning-line bg-warning-soft text-warning-strong', icon: <Clock className="h-4 w-4" />, text: 'Không có máy in nào sẵn sàng (hết hạn sau 2 phút, không in)' },
  };
  const v = map[s];
  return (
    <p data-testid={testId} data-status={s} role="status" className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-medium leading-4 ${v.cls}`}>
      <span aria-hidden className="shrink-0">
        {v.icon}
      </span>
      {v.text}
    </p>
  );
}

/**
 * In từ xa (SPEC 12.6): chọn quầy (mặc định quầy đã bán đơn) → gửi lệnh → trạng thái theo thời gian thực.
 * Máy này có máy in (app Android) ⇒ thêm lựa chọn "In ở máy này".
 */
export function RemotePrint({
  client,
  kind,
  orderId,
  defaultProfileId,
  label,
  testId,
  variant = 'dark',
  optionPrefix = '',
}: {
  client: SupabaseClient;
  kind: PrintKind;
  orderId: string | null;
  defaultProfileId: string | null;
  label: string;
  testId: string;
  /** Kiểu nút gửi lệnh (Figma T22: "In lại bill" đen, "Phiếu bếp" viền). */
  variant?: 'dark' | 'outline' | 'brand';
  /** Chữ đứng trước tên quầy trong ô chọn (Figma R33 "In tại: Tablet A"). */
  optionPrefix?: string;
}) {
  const [profiles, setProfiles] = useState<TabletProfileOption[] | null>(null);
  const [target, setTarget] = useState<string>(defaultProfileId ?? '');
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localDone, setLocalDone] = useState<boolean | null>(null);
  const job = useJob(client, jobId);
  const local = printService().enabled;

  useEffect(() => {
    let alive = true;
    listTabletProfiles(client)
      .then((p) => {
        if (!alive) return;
        setProfiles(p);
        setTarget((t) => t || p[0]?.id || '');
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client]);

  async function send() {
    setBusy(true);
    setError(null);
    setLocalDone(null);
    setJobId(null);
    try {
      if (target === 'here') {
        setLocalDone(await printService().printLocal({ kind, orderId }, supabasePrintApi(client)));
        return;
      }
      const res = await supabasePrintApi(client).create({ kind, orderId, profileId: target || null });
      setJobId(res.job.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5" data-testid={testId}>
      <div className="flex items-center gap-2.5">
        <SelectBox icon={PrinterIcon} className="flex-1" value={target} onChange={(e) => setTarget(e.target.value)} data-testid={`${testId}-target`} aria-label="In tại">
          {local && <option value="here">{optionPrefix}Máy này</option>}
          {profiles?.map((p) => (
            <option key={p.id} value={p.id}>
              {optionPrefix}
              {p.name}
              {p.id === defaultProfileId ? ' (quầy bán)' : ''}
            </option>
          ))}
        </SelectBox>
        <button
          type="button"
          className={btn(variant, variant === 'outline' ? 'min-h-[46px] shrink-0' : 'shrink-0')}
          disabled={busy || !target}
          onClick={() => void send()}
          data-testid={`${testId}-send`}
        >
          <PrinterIcon aria-hidden className="h-4 w-4" />
          {label}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger-strong" data-testid={`${testId}-error`}>
          {error}
        </p>
      )}
      {job && <JobStatusLine job={job} testId={`${testId}-status`} place={profiles?.find((p) => p.id === job.tablet_profile_id)?.name} />}
      {localDone !== null && (
        <p role="status" data-testid={`${testId}-status`} data-status={localDone ? 'printed' : 'failed'} className="text-[13px] font-medium">
          {localDone ? 'Đã in ở máy này' : `In lỗi: ${printService().getSnapshot().failure?.message ?? 'không rõ lý do'}`}
        </p>
      )}
    </div>
  );
}
