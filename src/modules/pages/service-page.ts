/**
 * The service page: one `service_id`, and every day it runs.
 *
 * yard-master's own page. A service is the thing a trip points at to say when
 * it happens, and until now it was only ever visible as three lines on a trip
 * page. It is an object here, with the waterfall chart as its headline — the
 * weekly pattern as a shaded span, the `calendar_dates.txt` exceptions as ticks
 * over it — and the routes and trips that use it underneath.
 *
 * Both halves of the calendar are rendered even when one is missing: a service
 * with no `calendar.txt` row runs on its added dates alone, which is a real and
 * common feed, and a page that assumed the weekly row would be there would
 * report it as running never.
 */

import { CONFIG } from '../../config';
import type { Trip } from '../../gtfs-static';
import type { PageState } from '../../types/page-state';
import { entityRow, entityRowList, rowSection } from '../entity-row';
import type { RenderContext } from '../render-utils';
import {
  escHtml,
  formatScheduledTime,
  missing,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  section,
} from '../render-utils';
import {
  renderServiceChart,
  serviceCatalog,
  serviceChartLegend,
  tripsForService,
  weekdaysLabel,
} from '../service-catalog';

/** The exception dates, as a wrapped list behind a disclosure. */
function dateList(label: string, dates: readonly string[]): string {
  if (dates.length === 0) return '';
  return `<details class="text-xs" data-detail="service:${escHtml(label)}">
    <summary class="cursor-pointer opacity-60">${escHtml(
      `${dates.length} ${label}`
    )}</summary>
    <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">${dates
      .map((date) => `<li>${escHtml(date)}</li>`)
      .join('')}</ul>
  </details>`;
}

/** The routes with at least one trip on this service, in feed order. */
function renderRoutes(ctx: RenderContext, routeIds: readonly string[]): string {
  const feed = ctx.session.staticFeed!;
  const rows = routeIds.map((routeId) => {
    const route = feed.routes.get(routeId);
    return entityRow(ctx, {
      state: { type: 'route', route_id: routeId },
      leadHtml: route ? routeBadge(ctx, route) : '',
      label: route ? route.long_name || route.short_name || route.id : routeId,
    });
  });

  return rowSection('Routes', routeIds.length, entityRowList(rows, 'No route runs on this service.'));
}

/**
 * The trips on this service, ordered by first departure.
 *
 * Capped the way the route page's trip list is: a weekday service on a busy
 * feed carries thousands of trips, and the panel rebuilds every row on each
 * realtime poll.
 */
function renderTrips(ctx: RenderContext, trips: Trip[]): string {
  const feed = ctx.session.staticFeed!;

  // Sorted on the raw clock string: GTFS times are zero-padded and may run past
  // 24:00, so lexicographic order is departure order and a Date would break it.
  const departure = (tripId: string): string =>
    feed.stopTimesByTrip.get(tripId)?.[0]?.departure_time ?? '';
  trips.sort((a, b) => departure(a.trip_id).localeCompare(departure(b.trip_id)));

  const shown = trips.slice(0, CONFIG.ROUTE_TRIP_LIST_MAX);
  const rows = shown.map((trip) =>
    entityRow(ctx, {
      state: { type: 'trip', trip_id: trip.trip_id, route_id: trip.route_id },
      label: trip.raw.trip_short_name?.trim() || trip.headsign || trip.trip_id,
      badge: formatScheduledTime(departure(trip.trip_id) || undefined, false),
    })
  );

  const more =
    trips.length > shown.length
      ? `<p class="text-xs opacity-50">${escHtml(
          `${trips.length - shown.length} more trips not shown.`
        )}</p>`
      : '';

  return rowSection(
    'Trips',
    trips.length,
    `${entityRowList(rows, 'No trip runs on this service.')}${more}`
  );
}

export function renderServicePage(
  ctx: RenderContext,
  state: Extract<PageState, { type: 'service' }>
): string {
  const feed = ctx.session.staticFeed;
  if (!feed) return missing(`Service ${state.service_id}`);

  const service = serviceCatalog(feed).get(state.service_id);
  if (!service) return missing(`Service ${state.service_id}`);

  // One pass over the feed's trips, shared by both sections: the catalog does
  // not walk them, since every other page that draws a service does not care.
  const trips = tripsForService(feed, service.id);
  const routeIds: string[] = [];
  const seenRoutes = new Set<string>();
  for (const trip of trips) {
    if (!trip.route_id || seenRoutes.has(trip.route_id)) continue;
    seenRoutes.add(trip.route_id);
    routeIds.push(trip.route_id);
  }

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <p class="text-xs uppercase tracking-wide opacity-50">Service</p>
        <h2 class="text-lg font-semibold leading-tight font-mono">${escHtml(service.id)}</h2>
        <p class="text-xs opacity-60">${escHtml(weekdaysLabel(service.days))}</p>
      </div>

      ${section(
        'Calendar',
        `${renderServiceChart(ctx, [service], {
          linkLabels: false,
          emptyMessage: 'This service names no dates at all.',
        })}
         ${serviceChartLegend()}
         ${dateList('added dates', service.added)}
         ${dateList('removed dates', service.removed)}`
      )}

      ${renderRoutes(ctx, routeIds)}
      ${renderTrips(ctx, trips)}

      ${section(
        'Properties',
        propList([
          prop('service_id', `<span class="font-mono">${escHtml(service.id)}</span>`),
          prop(
            'Runs',
            service.calendar
              ? escHtml(weekdaysLabel(service.days))
              : '<span class="opacity-60">no calendar.txt row — the added dates alone</span>'
          ),
          service.start && service.end
            ? prop('Window', escHtml(`${service.start} to ${service.end}`))
            : '',
          prop('Added dates', String(service.added.length)),
          prop('Removed dates', String(service.removed.length)),
          prop('Trips', String(trips.length)),
        ])
      )}
      ${service.calendar ? renderRawFields('calendar.txt', service.calendar.raw) : ''}
    </div>`;
}
