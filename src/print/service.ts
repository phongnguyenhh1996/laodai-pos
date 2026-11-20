import type { SupabaseClient } from '@supabase/supabase-js';
import { escposRaster } from './escpos';
import { layoutBill, layoutKitchen, layoutTest } from './layout';
import { PrinterError, type Printer } from './printer';
import type { MonoImage } from './render';
import { normalizeTemplate, type KitchenEdit, type Line, type PrintDoc, type PrintKind, type PrintTemplate } from './types';

/**
 * Dịch vụ in trên máy có máy in: tạo / nhận lệnh trên server (`print_jobs`), vẽ phiếu, gửi máy in, báo kết quả.
 * Lỗi in KHÔNG BAO GIỜ ném ra ngoài (không chặn tạo đơn / thanh toán): chỉ ghi lại để tablet báo đỏ.
 */

export type JobStatus = 'pending' | 'claimed' | 'printed' | 'failed' | 'expired';

export interface PrintJob {
  id: string;
  kind: PrintKind;
  order_id: string | null;
  order_code?: string | null;
  tablet_profile_id: string;
  tablet_name?: string;
  source: 'auto' | 'staff' | 'owner';
  status: JobStatus;
  device_id: string | null;
  detail: { edit?: KitchenEdit } | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export type CreateResult =
  | { status: 'claimed'; job: PrintJob; doc: PrintDoc | null; template: Partial<PrintTemplate> }
  | { status: 'pending'; job: PrintJob };

export type ClaimResult = Extract<CreateResult, { status: 'claimed' }> | { status: 'taken' | 'expired' };

export interface CreateArgs {
  kind: PrintKind;
  orderId?: string | null;
  /** Chủ gửi tới quầy (để trống: quầy đã bán đơn). */
  profileId?: string | null;
  /** Có ⇒ in tại chỗ (máy tự nhận luôn). */
  deviceId?: string | null;
  source?: 'auto' | 'staff';
  detail?: { edit?: KitchenEdit } | null;
}

export interface PrintApi {
  create(a: CreateArgs): Promise<CreateResult>;
  claim(jobId: string, deviceId: string): Promise<ClaimResult>;
  finish(jobId: string, deviceId: string, ok: boolean, error?: string | null): Promise<void>;
  /** Lệnh đang chờ của quầy (vừa mở app / vừa kết nối lại máy in). */
  pending(profileId: string): Promise<Array<Pick<PrintJob, 'id' | 'created_at'>>>;
  /** Nghe lệnh mới của quầy (Realtime). Trả hàm hủy. */
  onJob(profileId: string, fn: (job: PrintJob) => void): () => void;
}

export class PrintApiError extends Error {}

let channelSeq = 0;

export function supabasePrintApi(client: SupabaseClient): PrintApi {
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    let res: Awaited<ReturnType<SupabaseClient['rpc']>>;
    try {
      res = await client.rpc(fn, args);
    } catch (e) {
      throw new PrintApiError(e instanceof Error ? e.message : String(e));
    }
    if (res.error) throw new PrintApiError(res.error.message);
    return res.data as T;
  };
  return {
    create: (a) =>
      rpc<CreateResult>('print_job_create', {
        p_kind: a.kind,
        p_order: a.orderId ?? null,
        p_profile: a.profileId ?? null,
        p_device: a.deviceId ?? null,
        p_source: a.source ?? null,
        p_detail: a.detail ?? null,
      }),
    claim: (id, device) => rpc<ClaimResult>('print_job_claim', { p_job: id, p_device: device }),
    finish: async (id, device, ok, error) => {
      await rpc('print_job_finish', { p_job: id, p_device: device, p_ok: ok, p_error: error ?? null });
    },
    async pending(profileId) {
      const since = new Date(Date.now() - 2 * 60_000).toISOString();
      const { data, error } = await client
        .from('print_jobs')
        .select('id,created_at')
        .eq('tablet_profile_id', profileId)
        .eq('status', 'pending')
        .gt('created_at', since)
        .order('created_at');
      if (error) throw new PrintApiError(error.message);
      return data ?? [];
    },
    onJob(profileId, fn) {
      const ch = client
        .channel(`print-jobs-${profileId}-${++channelSeq}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'print_jobs', filter: `tablet_profile_id=eq.${profileId}` },
          (m) => fn(m.new as PrintJob),
        )
        .subscribe();
      return () => void client.removeChannel(ch);
    },
  };
}

/** Lỗi in gần nhất (tablet báo đỏ). */
export interface PrintFailure {
  kind: PrintKind;
  orderId: string | null;
  orderCode: string | null;
  message: string;
  at: number;
}

export interface PrintServiceState {
  busy: boolean;
  failure: PrintFailure | null;
  /** Số phiếu đã in xong trong phiên (để giao diện biết vừa in). */
  printed: number;
}

export type Renderer = (lines: Line[]) => Promise<MonoImage>;

export interface PrintServiceOptions {
  render?: Renderer;
  tz?: string;
  /** Số thứ tự hàng đợi của đơn trên máy này (phiếu bếp nhận từ xa). */
  queueNo?: (orderId: string) => number | null;
  now?: () => number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function defaultRender(lines: Line[]): Promise<MonoImage> {
  const { renderTicket } = await import('./render');
  return (await renderTicket(lines)).image;
}

/** Phiếu cần in của một lệnh đã nhận. */
export function linesForJob(
  res: Extract<CreateResult, { status: 'claimed' }>,
  opts: { tz?: string; queueNo?: number | null } = {},
): Line[] {
  const template = normalizeTemplate(res.template);
  if (res.job.kind === 'test') return layoutTest(template, opts.tz);
  if (!res.doc) throw new PrinterError('Không có nội dung đơn');
  if (res.job.kind === 'bill') return layoutBill({ doc: res.doc, template, tz: opts.tz });
  return layoutKitchen({ doc: res.doc, template, tz: opts.tz, queueNo: opts.queueNo, edit: res.job.detail?.edit ?? null });
}

export class PrintService {
  private state: PrintServiceState = { busy: false, failure: null, printed: 0 };
  private listeners = new Set<() => void>();
  private render: Renderer;
  private tz?: string;
  private queueNoOf: (orderId: string) => number | null;
  private now: () => number;
  private stopRemote: (() => void) | null = null;
  private stopPrinter: (() => void) | null = null;
  private running = 0;
  private seenJobs = new Set<string>();

  constructor(
    private api: PrintApi,
    readonly printer: Printer,
    private deviceId: string | null,
    opts: PrintServiceOptions = {},
  ) {
    this.render = opts.render ?? defaultRender;
    this.tz = opts.tz;
    this.queueNoOf = opts.queueNo ?? (() => null);
    this.now = opts.now ?? Date.now;
  }

  /** Máy này in được không (app Android + có mã thiết bị). */
  get enabled(): boolean {
    return this.printer.supported && this.deviceId !== null;
  }

  setQueueNo(fn: (orderId: string) => number | null): void {
    this.queueNoOf = fn;
  }

  getSnapshot = (): PrintServiceState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(p: Partial<PrintServiceState>): void {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn();
  }

  dismissFailure(): void {
    this.set({ failure: null });
  }

  private fail(kind: PrintKind, orderId: string | null, orderCode: string | null, message: string): void {
    this.set({ failure: { kind, orderId, orderCode, message, at: this.now() } });
  }

  private async track<T>(fn: () => Promise<T>): Promise<T> {
    this.running++;
    this.set({ busy: true });
    try {
      return await fn();
    } finally {
      this.running--;
      this.set({ busy: this.running > 0 });
    }
  }

  /** Lệnh đã nhận: vẽ, in, báo kết quả. Trả true khi in xong. */
  private async printClaimed(res: Extract<CreateResult, { status: 'claimed' }>, api: PrintApi): Promise<boolean> {
    const job = res.job;
    const device = job.device_id!;
    let error: string | null = null;
    try {
      const lines = linesForJob(res, { tz: this.tz, queueNo: job.order_id ? this.queueNoOf(job.order_id) : null });
      const image = await this.render(lines);
      await this.printer.print(escposRaster(image));
    } catch (e) {
      error = errText(e) || 'Lỗi máy in';
    }
    try {
      await api.finish(job.id, device, error === null, error);
    } catch {
      /* mất mạng khi báo kết quả: server tự đánh lỗi sau 5 phút */
    }
    if (error !== null) {
      this.fail(job.kind, job.order_id, res.doc?.code ?? job.order_code ?? null, error);
      return false;
    }
    this.set({ printed: this.state.printed + 1, failure: this.state.failure?.orderId === job.order_id ? null : this.state.failure });
    return true;
  }

  /** In tại chỗ (tự in / nhân viên bấm in lại phiếu bếp / chủ in thử trên máy này). Không ném lỗi. */
  async printLocal(args: Omit<CreateArgs, 'deviceId' | 'profileId'> & { orderCode?: string | null }, api: PrintApi = this.api): Promise<boolean> {
    if (!this.enabled) return false;
    return this.track(async () => {
      let res: CreateResult;
      try {
        res = await api.create({ ...args, deviceId: this.deviceId });
      } catch (e) {
        this.fail(args.kind, args.orderId ?? null, args.orderCode ?? null, `Không in được: ${errText(e)}`);
        return false;
      }
      if (res.status !== 'claimed') return false;
      return this.printClaimed(res, api);
    });
  }

  printKitchen(orderId: string, orderCode: string, source: 'auto' | 'staff', edit?: KitchenEdit | null): Promise<boolean> {
    return this.printLocal({ kind: 'kitchen', orderId, orderCode, source, detail: edit ? { edit } : null });
  }

  printBill(orderId: string, orderCode: string): Promise<boolean> {
    return this.printLocal({ kind: 'bill', orderId, orderCode, source: 'auto' });
  }

  /** Lệnh từ xa: chỉ nhận khi máy in đang kết nối (máy khác cùng quầy có máy in sẵn sàng thì để máy đó in). */
  async handleRemote(jobId: string): Promise<boolean> {
    if (!this.enabled || this.seenJobs.has(jobId)) return false;
    if (this.printer.getSnapshot().state !== 'connected') return false;
    this.seenJobs.add(jobId);
    return this.track(async () => {
      let res: ClaimResult;
      try {
        res = await this.api.claim(jobId, this.deviceId!);
      } catch {
        this.seenJobs.delete(jobId);
        return false;
      }
      if (res.status !== 'claimed') return false;
      return this.printClaimed(res, this.api);
    });
  }

  /** Lấy các lệnh đang chờ của quầy rồi nhận lần lượt. */
  async drainPending(profileId: string): Promise<void> {
    if (!this.enabled || this.printer.getSnapshot().state !== 'connected') return;
    let jobs: Array<{ id: string }> = [];
    try {
      jobs = await this.api.pending(profileId);
    } catch {
      return;
    }
    for (const j of jobs) await this.handleRemote(j.id);
  }

  /** Bắt đầu nghe lệnh in từ xa của quầy; tự kết nối máy in đã chọn. */
  start(profileId: string): void {
    this.stop();
    if (!this.enabled) return;
    this.stopRemote = this.api.onJob(profileId, (job) => {
      if (job.status === 'pending') void this.handleRemote(job.id);
    });
    let last = this.printer.getSnapshot().state;
    this.stopPrinter = this.printer.subscribe(() => {
      const s = this.printer.getSnapshot().state;
      if (s === 'connected' && last !== 'connected' && last !== 'printing') void this.drainPending(profileId);
      last = s;
    });
    void this.printer.connect().then((ok) => (ok ? this.drainPending(profileId) : undefined));
  }

  stop(): void {
    this.stopRemote?.();
    this.stopPrinter?.();
    this.stopRemote = this.stopPrinter = null;
  }
}
