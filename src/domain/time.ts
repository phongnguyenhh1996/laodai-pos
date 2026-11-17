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
