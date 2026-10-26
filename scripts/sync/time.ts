// Zeitrechnung in deutscher Zeit (Europe/Berlin), ohne Zusatzpakete.
const TZ = 'Europe/Berlin';

const parts = (d: Date) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
};

/** YYYY-MM-DD in deutscher Zeit */
export const berlinDate = (d: Date) => parts(d).date;
/** HH:MM in deutscher Zeit */
export const berlinTime = (d: Date) => parts(d).time;

/** Deutsche Uhrzeit an einem Tag → Zeitpunkt (berücksichtigt Sommerzeit). */
export function berlinToDate(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i += 1) {
    const p = parts(new Date(guess));
    const [ph, pm] = p.time.split(':').map(Number);
    const [py, pmo, pd] = p.date.split('-').map(Number);
    const diff = Date.UTC(py, pmo - 1, pd, ph, pm) - Date.UTC(y, m - 1, d, h, mi);
    guess -= diff;
  }
  return new Date(guess);
}

export const minutes = (n: number) => n * 60_000;
export const hours = (n: number) => n * 3_600_000;

/** „16:05“ bzw. „Di 16:05“, wenn nicht heute */
export function fmtWhen(d: Date, now: Date): string {
  const t = berlinTime(d);
  if (berlinDate(d) === berlinDate(now)) return t;
  const wd = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
  return `${wd} ${t}`;
}
