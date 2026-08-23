/**
 * The feed's services, as the timeline chart wants them.
 *
 * yard-master's own file. `calendar.txt` and `calendar_dates.txt` are two
 * halves of one answer — a weekly pattern over a window, and the individual
 * days that break it — and every page that asks "when does this run" has to
 * put them back together. This is where that happens, once, so the services
 * page, the service page, the route and stop pages and the trip page all draw
 * the same rows.
 *
 * GTFS dates are compact `YYYYMMDD` and everything else in this repo is a
 * `ServiceDate` (`YYYY-MM-DD`), so the conversion happens here at the edge and
 * nothing downstream sees the zip's form.
 */

import type { Calendar, GTFSStatic, Trip } from '../gtfs-static';
import type { RenderContext } from './render-utils';
import { entityLink } from './render-utils';
import type { ServiceDate } from './service-date';
import { WEEKDAY_LABELS } from './service-date';
import type { TimelineRow } from './timeline-chart';
import { renderTimelineChart } from './timeline-chart';

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
  const named = WEEKDAY_LABELS.filter((_, i) => days[i]);
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
export function serviceIds(feed: GTFSStatic): Set<string> {
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
 * realtime poll and a feed has tens of thousands of trips; the one page that
 * needs them asks for its own service's, with `tripsForService`.
 */
export function serviceCatalog(feed: GTFSStatic): Map<string, ServiceSummary> {
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

/** The trips on a service, in feed order. One pass; nothing is indexed. */
export function tripsForService(feed: GTFSStatic, serviceId: string): Trip[] {
  return [...feed.trips.values()].filter((trip) => trip.service_id === serviceId);
}

/** The services the given trips run on, deduplicated and in cascade order. */
export function servicesForTrips(feed: GTFSStatic, trips: Iterable<Trip>): ServiceSummary[] {
  const catalog = serviceCatalog(feed);
  const ids = new Set<string>();
  for (const trip of trips) ids.add(trip.service_id);
  return sortServices([...catalog.values()].filter((service) => ids.has(service.id)));
}

/**
 * Cascade order: earliest window first, and a service with no `calendar.txt`
 * window last under its id. Reading which service takes over from which is the
 * reason to draw them together, and id order says nothing about that.
 */
export function sortServices(services: ServiceSummary[]): ServiceSummary[] {
  return services.sort((a, b) => {
    const start = (a.start ?? '9999-99-99').localeCompare(b.start ?? '9999-99-99');
    return start !== 0 ? start : a.id.localeCompare(b.id);
  });
}

/**
 * One service as a chart row.
 *
 * The shaded span is the `calendar.txt` window, and only where the service
 * actually runs on a weekday: a row with every weekday off runs on its added
 * dates alone, and shading its window would claim a whole year of service that
 * is not there. The exceptions are the ticks over the top, which is exactly
 * what `calendar_dates.txt` means.
 */
export function serviceTimelineRow(service: ServiceSummary, color?: string): TimelineRow {
  // A service has no colour of its own, so the accent is the default and a
  // caller with a better one — a route's own colour — passes it in. The row
  // needs some colour either way: the shading is what draws the span.
  const runsWeekly = service.days.some(Boolean);
  const days = weekdaysLabel(service.days);
  const spans =
    runsWeekly && service.start && service.end && service.start <= service.end
      ? [
          {
            from: service.start,
            to: service.end,
            tooltip: `${service.id}: ${days}, ${service.start} to ${service.end}`,
          },
        ]
      : [];

  return {
    key: service.id,
    label: service.id,
    color: color ?? 'var(--color-primary)',
    spans,
    weekdays: service.days,
    ticks: [
      ...service.added.map((date) => ({ date, kind: 'added' as const })),
      ...service.removed.map((date) => ({ date, kind: 'removed' as const })),
    ],
    title: `${service.id} — ${days}`,
  };
}

/**
 * A chart of services, each label a link to its own page.
 *
 * The label is the link rather than the row, so the panel's own `data-nav`
 * delegation carries the click and the chart needs no listeners: a `<tr>` is
 * not something an `<a>` can wrap.
 */
export function renderServiceChart(
  ctx: RenderContext,
  services: readonly ServiceSummary[],
  options: { color?: string; emptyMessage?: string; linkLabels?: boolean } = {}
): string {
  const rows = services.map((service) => ({
    ...serviceTimelineRow(service, options.color),
    // The service's own page is the one place the label is not a link: it is
    // already the page you are on.
    ...(options.linkLabels === false
      ? {}
      : {
          labelHtml: entityLink(
            ctx,
            { type: 'service', service_id: service.id },
            service.id,
            'link link-hover font-mono'
          ),
        }),
  }));

  return renderTimelineChart(rows, {
    ...(options.emptyMessage ? { emptyMessage: options.emptyMessage } : {}),
  });
}

/** What the ticks under a chart mean. Every chart that draws them says so. */
export function serviceChartLegend(): string {
  return `<p class="text-xs opacity-50">A shaded week is a week the service runs on its weekdays.
    A triangle is a date <span class="text-success">added</span> or
    <span class="text-error">removed</span> by calendar_dates.txt.</p>`;
}
