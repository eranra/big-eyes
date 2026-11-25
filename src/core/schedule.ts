/** Working hours: show the eyes only inside a time window. */
export interface ScheduleSettings {
  scheduleEnabled: boolean;
  /** Window start, 'HH:MM' (inclusive). */
  scheduleStart: string;
  /** Window end, 'HH:MM' (inclusive). A start later than the end wraps past midnight. */
  scheduleEnd: string;
}

function minutesOfDay(time: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Whether the eyes may show at this moment. Disabled = always. The window is inclusive on both
 * ends; a start later than the end is an overnight window (for example 22:00–06:00).
 */
export function withinSchedule(s: ScheduleSettings, now: Date): boolean {
  if (!s.scheduleEnabled) return true;
  const start = minutesOfDay(s.scheduleStart);
  const end = minutesOfDay(s.scheduleEnd);
  if (start === null || end === null) return true; // invalid times: do not block
  const t = now.getHours() * 60 + now.getMinutes();
  if (start <= end) return t >= start && t <= end;
  return t >= start || t <= end; // overnight
}
