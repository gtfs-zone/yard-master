/**
 * The feed's services: both calendar files resolved into one answer.
 *
 * yard-master's own file. `calendar.txt` and `calendar_dates.txt` are two
 * halves of one answer — a weekly pattern over a window, and the individual
 * days that break it — and every page that asks "when does this run" has to
 * put them back together. This is where that happens, once, so the route, stop
 * and trip pages and the calendar all say the same thing about a service.
 *
 * Data only. This file used to draw the services waterfall as well; a service
 * is no longer an object this app browses, so the rows it fed are gone and
 * what is left is the resolution.
 *
 * GTFS dates are compact `YYYYMMDD` and everything else in this repo is a
 * `ServiceDate` (`YYYY-MM-DD`), so the conversion happens here at the edge and
 * nothing downstream sees the zip's form.
 */

import type { Calendar, GTFSScheduled, Trip } from 'interlocking/gtfs/scheduled';
import type { FeedSession } from './feed-session';
import type { ServiceDate } from './service-date';
import { ruleWeekdayIndex, WEEKDAY_DISPLAY, WEEKDAY_LABELS } from './service-date';

/** One service_id, with both halves of its calendar resolved. */
export interface ServiceSummary {
  id: string;
  /** Absent for a service that lives entirely in `calendar_dates.txt`. */
  calendar?: Calendar;
  /** Monday-first, all false where there is no `calendar.txt` row. */
  days: boolean[];
  start?: ServiceDate;
  end?: ServiceDate;
  /** `exception_type` 1, sorted. */
  added: ServiceDate[];
  /** `exception_type` 2, sorted. */
  removed: ServiceDate[];
}

/** `2024-03-01` from the zip's `20240301`. Null for anything else. */
export function toServiceDate(compact: string | undefined): ServiceDate | null {
  if (!compact || !/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
}

/** `Mon, Wed, Fri`, or what a service with no weekly pattern runs on. */
export function weekdaysLabel(days: readonly boolean[]): string {
  // `days` is Monday-first, the labels are in display order, so the flag each
  // label is about is the one `WEEKDAY_DISPLAY` points at.
  const named = WEEKDAY_LABELS.filter((_, slot) => days[WEEKDAY_DISPLAY[slot]]);
  if (named.length === 7) return 'Every day';
  if (named.length === 0) return 'No weekly pattern';
  return named.join(', ');
}

/**
 * Every `service_id` either calendar file names.
 *
 * Cheaper than `serviceCatalog`, which walks every trip in the feed: this is
 * for the callers that only need to know whether a service exists, or how many
 * there are.
 */
export function serviceIds(feed: GTFSScheduled): Set<string> {
  const ids = new Set<string>();
  for (const row of feed.calendar) ids.add(row.service_id);
  for (const row of feed.calendarDates) ids.add(row.service_id);
  return ids;
}

/**
 * Every service the zip names, keyed by `service_id`.
 *
 * A service can be named by either file alone, so the map is seeded from both:
 * a `calendar_dates.txt`-only service is a real service that runs on exactly
 * the dates it lists, and dropping it would hide trips.
 *
 * Trips are deliberately not walked here. The panel rebuilds its page on every
 * realtime poll and a feed has tens of thousands of trips; a caller that needs
 * the services behind a set of trips passes them to `servicesForTrips`.
 */
export function serviceCatalog(feed: GTFSScheduled): Map<string, ServiceSummary> {
  const services = new Map<string, ServiceSummary>();

  const ensure = (id: string): ServiceSummary => {
    let service = services.get(id);
    if (!service) {
      service = {
        id,
        days: [false, false, false, false, false, false, false],
        added: [],
        removed: [],
      };
      services.set(id, service);
    }
    return service;
  };

  for (const row of feed.calendar) {
    const service = ensure(row.service_id);
    service.calendar = row;
    service.days = row.days;
    service.start = toServiceDate(row.start_date) ?? undefined;
    service.end = toServiceDate(row.end_date) ?? undefined;
  }

  for (const exception of feed.calendarDates) {
    const date = toServiceDate(exception.date);
    if (!date) continue;
    const service = ensure(exception.service_id);
    if (exception.exception_type === 2) service.removed.push(date);
    else service.added.push(date);
  }

  for (const service of services.values()) {
    service.added.sort();
    service.removed.sort();
  }
  return services;
}

/**
 * Whether a service runs on one date.
 *
 * The two files are read in the order GTFS gives them: `calendar_dates.txt`
 * wins outright, and only where it says nothing does the weekly pattern inside
 * its window answer. A service with no `calendar.txt` row therefore runs on its
 * added dates and nowhere else.
 */
export function serviceRunsOn(service: ServiceSummary, date: ServiceDate): boolean {
  if (service.removed.includes(date)) return false;
  if (service.added.includes(date)) return true;
  if (!service.calendar) return false;
  if (service.start && date < service.start) return false;
  if (service.end && date > service.end) return false;
  return service.days[ruleWeekdayIndex(date)] === true;
}

/**
 * Cascade order: earliest window first, and a service with no `calendar.txt`
 * window last under its id. Which service takes over from which is the only
 * useful order for a list of them, and id order says nothing about that.
 */
export function sortByCascade(services: ServiceSummary[]): ServiceSummary[] {
  return services.sort((a, b) => {
    const start = (a.start ?? '9999-99-99').localeCompare(b.start ?? '9999-99-99');
    return start !== 0 ? start : a.id.localeCompare(b.id);
  });
}

/** The services the given trips run on, deduplicated and in cascade order. */
export function servicesForTrips(feed: GTFSScheduled, trips: Iterable<Trip>): ServiceSummary[] {
  const catalog = serviceCatalog(feed);
  const ids = new Set<string>();
  for (const trip of trips) ids.add(trip.service_id);
  return sortByCascade([...catalog.values()].filter((service) => ids.has(service.id)));
}

/** Every trip a rule names, from the feed's whole rule set. */
export function assignedTripIds(session: Pick<FeedSession, 'rules'>): Set<string> {
  const ids = new Set<string>();
  for (const rule of session.rules?.values() ?? []) ids.add(rule.trip_id);
  return ids;
}

/**
 * How many of the given trips a rule touches, against how many there are.
 *
 * Null until `session.rules` has been fetched: a feed with no rules loaded
 * yet reads as "unknown", not as "none assigned".
 */
export function assignmentCounts(
  session: Pick<FeedSession, 'rules'>,
  tripIds: Iterable<string>
): { assigned: number; total: number } | null {
  if (!session.rules) return null;
  const assigned = assignedTripIds(session);
  let total = 0;
  let hit = 0;
  for (const id of tripIds) {
    total++;
    if (assigned.has(id)) hit++;
  }
  return { assigned: hit, total };
}
