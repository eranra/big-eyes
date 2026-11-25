export type Season = 'snow' | 'leaves' | 'hearts';

/**
 * The season of a date, for a little background sparkle while the eyes are shown:
 * snow in December, leaves in autumn (September–November), hearts on February 14.
 * Anything else: null (nothing drawn).
 */
export function seasonFor(date: Date): Season | null {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 11) return 'snow';
  if (month >= 8 && month <= 10) return 'leaves';
  if (month === 1 && day === 14) return 'hearts';
  return null;
}
