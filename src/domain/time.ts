export const TZ = 'Asia/Ho_Chi_Minh';

/** Ngày kinh doanh "YYYY-MM-DD" theo giờ Việt Nam. */
export function businessDate(at: Date | string | number, tz = TZ): string {
  const d = new Date(at);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "05:42" theo giờ Việt Nam. */
export function hhmm(at: Date | string | number, tz = TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(at),
  );
}

export function minutesBetween(from: Date | string | number, to: Date | string | number): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
}

/** "Th 3 18/11 · 07:15" theo giờ Việt Nam (thứ + ngày/tháng + giờ). */
export function dayTime(at: Date | string | number, tz = TZ): string {
  const d = new Date(at);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  const thu = { Sun: 'CN', Mon: 'Th 2', Tue: 'Th 3', Wed: 'Th 4', Thu: 'Th 5', Fri: 'Th 6', Sat: 'Th 7' }[wd] ?? '';
  const dm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(d);
  return `${thu} ${dm} · ${hhmm(d, tz)}`;
}
