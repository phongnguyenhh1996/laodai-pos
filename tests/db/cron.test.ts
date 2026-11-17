import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, sql } from '../support/db';
import { SEED } from '../support/seed-ids';

describe('tổng kết ngày (pg_cron)', () => {
  beforeEach(resetDb);

  it('cron được lên lịch', async () => {
    const jobs = await sql<{ jobname: string; schedule: string; command: string }>('select jobname, schedule, command from cron.job order by jobname');
    expect(jobs.map((j) => j.jobname)).toEqual(['laodai-daily-summary', 'laodai-retry-notifications']);
    expect(jobs[0].command).toContain('daily_summary_tick');
  });

  it('khoảng thời gian theo múi giờ Asia/Ho_Chi_Minh', async () => {
    const [r] = await sql(`select lower(private.day_range('2026-11-18')) f, upper(private.day_range('2026-11-18')) t`);
    expect(new Date(r.f).toISOString()).toBe('2026-11-17T17:00:00.000Z');
    expect(new Date(r.t).toISOString()).toBe('2026-11-18T17:00:00.000Z');
  });

  it('chưa tới giờ tổng kết thì không gửi; tới giờ gửi đúng một lần với đúng ngày', async () => {
    // 14:29 giờ VN ngày 18/11 = 07:29Z
    expect((await sql(`select private.daily_summary_tick('2026-11-18T07:29:00Z') id`))[0].id).toBeNull();
    const [{ id }] = await sql(`select private.daily_summary_tick('2026-11-18T07:30:00Z') id`);
    expect(id).not.toBeNull();
    expect((await sql(`select private.daily_summary_tick('2026-11-18T08:00:00Z') id`))[0].id).toBeNull();
    const [n] = await sql(`select business_date::text d, payload from notifications where id = $1`, [id]);
    expect(n.d).toBe('2026-11-18');
    expect(n.payload.date).toBe('2026-11-18');
    expect(new Date(n.payload.range.from).toISOString()).toBe('2026-11-17T17:00:00.000Z');
    expect(new Date(n.payload.range.to).toISOString()).toBe('2026-11-18T17:00:00.000Z');
  });

  it('giờ tổng kết lấy từ cài đặt', async () => {
    await sql(`update settings set daily_summary_time = '20:00'`);
    expect((await sql(`select private.daily_summary_tick('2026-11-18T07:30:00Z') id`))[0].id).toBeNull();
    expect((await sql(`select private.daily_summary_tick('2026-11-18T13:00:00Z') id`))[0].id).not.toBeNull();
  });

  it('đơn thanh toán lúc 23:30 giờ VN thuộc đúng ngày đó', async () => {
    await sql(
      `insert into shifts (id, tablet_profile_id, staff_id, opened_at, open_boxes, open_plates, open_float)
       values ('00000000-0000-4000-8000-0000000000e1', $1, $2, '2026-11-18T16:00:00Z', 0, 0, 0)`,
      [SEED.tablets.A, SEED.staff.Lan],
    );
    await sql(
      `insert into orders (id, device_seq, tablet_profile_id, point_id, code, dine_type, status, opened_shift_id, paid_shift_id,
                           created_at, paid_at, total, payment_method)
       values (gen_random_uuid(), 1, $1, $2, 'AAA', 'takeaway', 'paid', '00000000-0000-4000-8000-0000000000e1',
               '00000000-0000-4000-8000-0000000000e1', '2026-11-18T16:30:00Z', '2026-11-18T16:30:00Z', 25000, 'cash')`,
      [SEED.tablets.A, SEED.points.xoiA],
    );
    const [d18] = await sql(`select private.build_daily_summary('2026-11-18') s`);
    const [d19] = await sql(`select private.build_daily_summary('2026-11-19') s`);
    expect(d18.s.revenue.total).toBe(25000);
    expect(d18.s.by_point).toEqual([{ point_name: 'Xôi A', total: 25000 }]);
    expect(d19.s.revenue.total).toBe(0);
  });
});
