-- Tạm bỏ việc tự gửi tổng kết ngày qua Telegram: chủ quán tự xem báo cáo trong app.
-- Giữ nguyên các hàm (build_daily_summary, run_daily_summary, daily_summary_tick)
-- để bật lại chỉ cần cron.schedule lại như migration 20261117000004.
select cron.unschedule('laodai-daily-summary')
where exists (select 1 from cron.job where jobname = 'laodai-daily-summary');
