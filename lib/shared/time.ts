// Timezone-aware calendar math with zero dependencies (Intl only). Safe on server and client.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const pad = (n: number) => String(n).padStart(2, "0");

/** Offset of `tz` from UTC at `instant`, in minutes (IST → 330). */
export const tzOffsetMinutes = (instant: Date | number, tz: string): number => {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(new Date(instant))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
};

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export const dateInTz = (instant: Date | number | string, tz: string): string => {
  const ms = new Date(instant).getTime();
  return new Date(ms + tzOffsetMinutes(ms, tz) * MIN).toISOString().slice(0, 10);
};

/** Local hour (0–23) of an instant in `tz`. */
export const hourInTz = (instant: Date | number | string, tz: string): number => {
  const ms = new Date(instant).getTime();
  return new Date(ms + tzOffsetMinutes(ms, tz) * MIN).getUTCHours();
};

/** UTC ms of local midnight that starts `date` in `tz`. DST-safe (one refinement pass). */
export const zonedMidnight = (date: string, tz: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  let guess = naive - tzOffsetMinutes(naive, tz) * MIN;
  guess = naive - tzOffsetMinutes(guess, tz) * MIN;
  return guess;
};

export const dayRange = (date: string, tz: string) => ({
  startMs: zonedMidnight(date, tz),
  endMs: zonedMidnight(addDays(date, 1), tz)
});

export const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
};

/** Monday of the ISO week containing `date`. */
export const weekStart = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return addDays(date, -((dow + 6) % 7));
};

export const datesBetween = (start: string, endInclusive: string): string[] => {
  const out: string[] = [];
  for (let d = start; d <= endInclusive; d = addDays(d, 1)) out.push(d);
  return out;
};

export const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// ───────────── browser-local helpers ─────────────

export const localDate = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local Date for YYYY-MM-DD + minutes since midnight. */
export const localDateTime = (date: string, minutes: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, minutes);
};

export const fmtTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export const fmtDuration = (minutes: number) => {
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

export const fmtClock = (totalSec: number) => {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const mm = pad(Math.floor((s % 3600) / 60));
  const ss = pad(s % 60);
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// ───────────── interval math ─────────────

export interface Interval {
  start: number;
  end: number;
}

export const toInterval = (startIso: string, endIso: string): Interval => ({
  start: new Date(startIso).getTime(),
  end: new Date(endIso).getTime()
});

/** Sort + merge overlapping/touching intervals; drops empty ones. */
export const mergeIntervals = (list: Interval[]): Interval[] => {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
};

export const clip = (list: Interval[], window: Interval): Interval[] =>
  list
    .map((i) => ({ start: Math.max(i.start, window.start), end: Math.min(i.end, window.end) }))
    .filter((i) => i.end > i.start);

export const totalMs = (list: Interval[]) => list.reduce((s, i) => s + (i.end - i.start), 0);

/** Overlap between two interval sets (each may be unmerged). */
export const intersect = (a: Interval[], b: Interval[]): Interval[] => {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const start = Math.max(A[i].start, B[j].start);
    const end = Math.min(A[i].end, B[j].end);
    if (end > start) out.push({ start, end });
    if (A[i].end < B[j].end) i++;
    else j++;
  }
  return out;
};

export const msToMin = (ms: number) => ms / MIN;
