/**
 * Service-date arithmetic for the calendar.
 *
 * A service date is a bare `YYYY-MM-DD` string in **feed-local** time: the date
 * a rule's window starts on, and the date the rest of the pipeline stamps onto
 * a vehicle as its GTFS-RT `start_date`. It is not an instant, so nothing here
 * goes near the browser's zone except `today()`, which is the one question that
 * needs to know what time it is somewhere.
 *
 * Every helper works on the string, and where a `Date` is unavoidable it is
 * built at **UTC noon**. A date built at UTC midnight lands on the previous day
 * in every western zone the moment anything reads it locally, which is the
 * classic way a calendar grid ends up one day out for half the world.
 */

import { CONFIG } from '../config';
import { feedTimezone } from 'interlocking/gtfs/feed-time';

/** A `YYYY-MM-DD` service date. Named for what it means, not for its shape. */
export type ServiceDate = string;

/** Rule columns in `Date.getUTCDay()`-independent order: Monday first. */
export const WEEKDAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** One label per rule column, in `WEEKDAY_KEYS` order. */
const KEY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * For each display slot, the index into `WEEKDAY_KEYS` it shows.
 *
 * Display starts on `CONFIG.WEEK_START` and the rule columns start on Monday,
 * so everything that draws a week goes through this and everything that writes
 * a rule column does not.
 */
export const WEEKDAY_DISPLAY: readonly number[] = Array.from(
  { length: 7 },
  (_, slot) => (CONFIG.WEEK_START + slot + 6) % 7
);

/** Day labels in display order, aligned with `WEEKDAY_DISPLAY`. */
export const WEEKDAY_LABELS: readonly string[] = WEEKDAY_DISPLAY.map((i) => KEY_LABELS[i]);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isServiceDate(value: string | undefined): value is ServiceDate {
  if (!value || !DATE_RE.test(value)) return false;
  // Rejects 2026-02-31, which the pattern alone happily accepts.
  return format(asUtc(value)) === value;
}

/** UTC noon on that date, which is the only `Date` this module ever makes. */
function asUtc(date: ServiceDate): Date {
  const [, y, m, d] = DATE_RE.exec(date) ?? [];
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12));
}

function format(value: Date): ServiceDate {
  return value.toISOString().slice(0, 10);
}

/**
 * Today, in the loaded feed's zone.
 *
 * `en-CA` is `YYYY-MM-DD` and is used as a formatter rather than as a locale:
 * it is the shortest honest way to ask Intl which calendar date it is somewhere
 * else. Before the zip has parsed there is no feed zone, so this is the
 * reader's own date, which is the best answer available and is never worse than
 * a day out.
 */
export function today(): ServiceDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: feedTimezone() ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDays(date: ServiceDate, days: number): ServiceDate {
  const value = asUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return format(value);
}

/**
 * The same day-of-month a month away, clamped to the end of a shorter month:
 * a month after the 31st of January is the 28th of February, not the 3rd of
 * March. Month navigation lands on the 1st anyway; the clamp is what stops a
 * date typed into a rule from skipping a month.
 */
export function addMonths(date: ServiceDate, months: number): ServiceDate {
  const value = asUtc(date);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0, 12)
  ).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return format(value);
}

export function startOfMonth(date: ServiceDate): ServiceDate {
  return `${date.slice(0, 7)}-01`;
}

export function sameMonth(a: ServiceDate, b: ServiceDate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** The first day of the displayed week a date falls in. */
export function startOfWeek(date: ServiceDate): ServiceDate {
  return addDays(date, -weekdayIndex(date));
}

/** `Mon 17 Aug`, for a week header and a day chip. */
export function shortDayLabel(date: ServiceDate): string {
  return asUtc(date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** The display slot a date falls in: 0 is `CONFIG.WEEK_START`. */
export function weekdayIndex(date: ServiceDate): number {
  return (asUtc(date).getUTCDay() - CONFIG.WEEK_START + 7) % 7;
}

/** 0 for Monday, matching the order of `WEEKDAY_KEYS` and the rule columns. */
export function ruleWeekdayIndex(date: ServiceDate): number {
  return (asUtc(date).getUTCDay() + 6) % 7;
}

export function weekdayKey(date: ServiceDate): WeekdayKey {
  return WEEKDAY_KEYS[ruleWeekdayIndex(date)];
}

/** The bare day number, for a grid cell. */
export function dayOfMonth(date: ServiceDate): number {
  return Number(date.slice(8, 10));
}

/** `August 2026`, in the reader's locale. */
export function monthLabel(date: ServiceDate): string {
  return asUtc(date).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `Aug 2026`, for a header cell narrow enough to sit over a few weeks. */
export function monthShortLabel(date: ServiceDate): string {
  return asUtc(date).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `Mon 17 August`, for the day agenda's heading. */
export function dayLabel(date: ServiceDate): string {
  return asUtc(date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * The days a month grid draws: whole weeks starting on `CONFIG.WEEK_START`,
 * padded from the previous month and into the next one so every row has seven
 * cells.
 *
 * Five or six rows depending on where the month falls, never a fixed six: a
 * blank trailing week is a row of dead space in a panel that is already narrow.
 */
export function monthGrid(date: ServiceDate): ServiceDate[] {
  const first = startOfMonth(date);
  const start = addDays(first, -weekdayIndex(first));
  const last = addDays(addMonths(first, 1), -1);
  const end = addDays(last, 6 - weekdayIndex(last));

  const days: ServiceDate[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}
