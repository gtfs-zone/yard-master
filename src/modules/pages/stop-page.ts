/* @vendored-from test-track:src/modules/pages/stop-page.ts
   @sha fdb171c
   @status modified
   @changes
   - The `vehicle` PageState variant became `tracker`, keyed by `Tracker.id`.
   - "Vehicles here now" became "Trackers here now", and its renderer with it.
   - Departures link their trip through the new `trip` variant, which
     test-track has no page for.
   - A Service calendar section draws the services of the trips calling here on
     this repo's timeline chart.
   - Every list on the page — departures, trackers here now, platforms and
     sibling platforms — renders through this repo's `entity-row.ts` instead of
     its own `<li>` or `<table>` markup, so a stop's lists look like every other
     list in the app.
 */
/**
 * The stop page. For a platform (or a plain stop) this is what serves it, what
 * is predicted to arrive, and what is sitting at it now. For a *station* it is
 * the same questions answered over the whole place — every boardable platform
 * beneath it — because a station never appears in `stop_times` itself; its
 * services are named by its platforms (Plan 06 Root cause E).
 *
 * Aggregation is always labelled as aggregation: every merged row names the
 * child stop it came from, so nothing reads as though the station id appeared
 * in `stop_times`.
 */

import type { AlertRecord } from 'interlocking/gtfs/rt-types';
import type { Stop, Trip } from 'interlocking/gtfs/scheduled';
import type { PageState } from '../../types/page-state';
import { alertsForStop } from 'interlocking/gtfs/alerts';
import { stopTypeLabel } from 'interlocking/ui/breadcrumb-trail';
import { zoneLabel } from 'interlocking/gtfs/feed-time';
import type { RtIndex } from '../render-context';
import type { RenderContext } from '../render-context';
import { cappedNote, entityRow, entityRowList, rowSection } from '../entity-row';
import {
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  formatDelay,
  formatEpochTime,
  formatScheduledTime,
  missing,
  pageHeader,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  section,
  vehicleDisplayName,
} from 'interlocking/gtfs/entity-render';
import {
  servicesForTrips,
  weekdaysLabel,
} from '../service-catalog';
import { CONFIG } from '../../config';
import { renderAlertList } from './alert-page';

const MAX_DEPARTURES = 20;

/** A platform's rider-facing label: platform_code, then platform_name, then id. */
function platformLabel(stop: Stop): string {
  return (stop.raw.platform_code || stop.raw.platform_name || stop.id).trim() || stop.id;
}

/** The muted "this came from a child stop" tag every aggregated row carries. */
function fromChild(ctx: RenderContext, stopId: string): string {
  return `<span class="opacity-50 text-xs whitespace-nowrap">@ ${escHtml(
    childName(ctx, stopId),
  )}</span>`;
}

/** The same name as plain text, for a row's sublabel. */
function childName(ctx: RenderContext, stopId: string): string {
  const stop = ctx.session.scheduledFeed!.stops.get(stopId);
  return stop ? platformLabel(stop) : stopId;
}

function aggregationNote(count: number): string {
  return `<p class="text-xs opacity-50">Aggregated across ${count} platform${
    count === 1 ? '' : 's'
  } — these rows come from child stops in <span class="font-mono">stop_times</span>, not this station id.</p>`;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

function renderRoutes(ctx: RenderContext, serviceIds: string[], isStation: boolean): string {
  const feed = ctx.session.scheduledFeed!;
  // route_id -> the platforms that serve it
  const routePlatforms = new Map<string, Set<string>>();
  for (const id of serviceIds) {
    for (const routeId of feed.routesByStop.get(id) ?? []) {
      let set = routePlatforms.get(routeId);
      if (!set) routePlatforms.set(routeId, (set = new Set()));
      set.add(id);
    }
  }
  if (routePlatforms.size === 0) return '';

  if (!isStation) {
    return section(
      'Routes serving this stop',
      `<div class="flex flex-wrap gap-1">${[...routePlatforms.keys()]
        .map(id => {
          const route = feed.routes.get(id);
          return route
            ? routeBadge(ctx, route)
            : `<span class="badge badge-ghost badge-sm">${escHtml(id)}</span>`;
        })
        .join('')}</div>`,
    );
  }

  const rows = [...routePlatforms.entries()]
    .map(([routeId, platforms]) => {
      const route = feed.routes.get(routeId);
      const badge = route
        ? routeBadge(ctx, route)
        : `<span class="badge badge-ghost badge-sm">${escHtml(routeId)}</span>`;
      const platformTags = [...platforms]
        .map(id => fromChild(ctx, id))
        .join('<span class="opacity-30">-</span> ');
      return `<div class="flex items-center gap-2 flex-wrap">${badge}${platformTags}</div>`;
    })
    .join('');

  return section(
    'Routes serving this station',
    `${aggregationNote(new Set(serviceIds).size)}<div class="space-y-1">${rows}</div>`,
  );
}

// ─── Departures ─────────────────────────────────────────────────────────────

function renderDepartures(
  ctx: RenderContext,
  rt: RtIndex,
  serviceIds: string[],
  isStation: boolean,
): string {
  const feed = ctx.session.scheduledFeed!;
  const upcoming = isStation
    ? rt.upcomingAtStops(serviceIds, MAX_DEPARTURES)
    : rt.upcomingAtStop(serviceIds[0], MAX_DEPARTURES);
  if (upcoming.length === 0) {
    return section(
      'Upcoming departures',
      '<p class="text-xs opacity-60">No trip updates reference this stop.</p>',
    );
  }

  const rows = upcoming.map(p => {
    const trip = feed.trips.get(p.trip_id);
    const route = trip ? feed.routes.get(trip.route_id) : undefined;
    const scheduled = trip
      ? feed.stopTimesByTrip.get(trip.trip_id)?.find(t => t.stop_id === p.stop_id)?.departure_time
      : undefined;

    // Scheduled time, and the platform it leaves from where that is not the
    // page's own stop. Both are what tells two departures of one route apart.
    const detail = [
      `sched ${formatScheduledTime(scheduled, false)}`,
      isStation ? `@ ${childName(ctx, p.stop_id)}` : '',
    ].filter(Boolean);

    return entityRow(ctx, {
      state: { type: 'trip', trip_id: p.trip_id, route_id: trip?.route_id },
      leadHtml: route
        ? routeBadge(ctx, route)
        : `<span class="badge badge-ghost badge-sm">${escHtml(p.update.trip?.routeId ?? '?')}</span>`,
      label: trip?.headsign || p.trip_id,
      sublabel: detail.join(' - '),
      badgeHtml: `<span class="text-xs flex items-center gap-2 whitespace-nowrap">
        <span class="tabular-nums">${escHtml(formatEpochTime(p.time, false))}</span>
        ${formatDelay(p.delay)}
      </span>`,
    });
  });

  const body = `${entityRowList(rows, 'No trip updates reference this stop.')}
    <p class="text-xs opacity-50">Predicted times are in ${escHtml(zoneLabel())}.</p>`;

  return rowSection(
    'Upcoming departures',
    upcoming.length,
    isStation ? `${aggregationNote(new Set(serviceIds).size)}${body}` : body,
  );
}

// ─── Trackers here now ──────────────────────────────────────────────────────

function renderTrackersHere(
  ctx: RenderContext,
  rt: RtIndex,
  serviceIds: string[],
  isStation: boolean,
): string {
  const rows: string[] = [];
  for (const id of serviceIds) {
    for (const v of rt.vehiclesAtStop.get(id) ?? []) {
      rows.push(
        entityRow(ctx, {
          state: { type: 'tracker', tracker_id: v.trackerId },
          label: vehicleDisplayName(ctx.session.scheduledFeed, v),
          sublabel: isStation ? `@ ${childName(ctx, id)}` : undefined,
          badge: VEHICLE_STATUS_LABELS[v.currentStatus ?? -1] ?? '',
        }),
      );
    }
  }
  if (rows.length === 0) return '';
  return rowSection(
    'Trackers here now',
    rows.length,
    `${isStation ? aggregationNote(new Set(serviceIds).size) : ''}${entityRowList(
      rows,
      'Nothing is reporting from this stop.',
    )}`,
  );
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

/** Alerts naming the station or any descendant, deduped, each marked. */
function renderStationAlerts(ctx: RenderContext, ids: string[]): string {
  const seen = new Set<string>();
  const records: AlertRecord[] = [];
  for (const id of ids) {
    for (const record of alertsForStop(ctx.session, id)) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
    }
  }
  return renderAlertList(ctx, records, 'Alerts at this station');
}

// ─── Platforms and related stops ────────────────────────────────────────────

/**
 * The station's own structure: boardable platforms first, each with its code
 * and route badges, then the entrances and generic nodes collapsed so they
 * cannot bury the platforms (South Station has 131 of them over 23 platforms).
 */
function renderPlatforms(ctx: RenderContext, stopId: string): string {
  const feed = ctx.session.scheduledFeed!;
  const children = feed.descendants(stopId).map(id => feed.stops.get(id)!).filter(Boolean);
  if (children.length === 0) {
    return section('Platforms', '<p class="text-xs opacity-60">No platforms in this feed.</p>');
  }

  const boardable = children.filter(s => s.location_type === 0);
  const others = children.filter(s => s.location_type !== 0);

  const platformRow = (s: Stop): string => {
    const badges = [...(feed.routesByStop.get(s.id) ?? [])]
      .map(id => {
        const route = feed.routes.get(id);
        return route ? routeBadge(ctx, route) : '';
      })
      .join('');
    return entityRow(ctx, {
      state: { type: 'stop', stop_id: s.id },
      label: platformLabel(s),
      sublabel: s.id,
      badgeHtml: `<span class="flex gap-1 flex-wrap">${badges}</span>`,
    });
  };

  const boardableList = entityRowList(
    boardable.map(platformRow),
    'No boardable platforms in this feed.',
  );

  const otherList = others.length
    ? `<details class="text-xs">
         <summary class="cursor-pointer opacity-60">${others.length} entrance${
           others.length === 1 ? '' : 's'
         } and generic node${others.length === 1 ? '' : 's'}</summary>
         ${entityRowList(
           others.map(s =>
             entityRow(ctx, {
               state: { type: 'stop', stop_id: s.id },
               label: s.name || s.id,
               badge: stopTypeLabel(s.location_type),
             }),
           ),
           '',
         )}
       </details>`
    : '';

  return rowSection('Platforms', children.length, `${boardableList}${otherList}`);
}

/** For a platform: the parent's other platforms. Stations use renderPlatforms. */
function renderSiblingPlatforms(ctx: RenderContext, stop: Stop): string {
  const feed = ctx.session.scheduledFeed!;
  if (!stop.parent_station) return '';
  const siblings = (feed.childrenByParent.get(stop.parent_station) ?? [])
    .filter(id => id !== stop.id)
    .map(id => feed.stops.get(id)!)
    .filter(Boolean);
  if (siblings.length === 0) return '';

  return rowSection(
    'Sibling platforms',
    siblings.length,
    entityRowList(
      siblings.map(s =>
        entityRow(ctx, {
          state: { type: 'stop', stop_id: s.id },
          label: s.name || s.id,
          sublabel: s.id,
        }),
      ),
      'No sibling platforms.',
    ),
  );
}

/**
 * When anything calls here, as the waterfall.
 *
 * Over every trip that stops here rather than over the departures board: the
 * board is one day's worth, and this is the question of which days there is a
 * service at all. A station aggregates over its platforms, exactly as its
 * routes and departures do. A service is not an object this app browses, so a
 * row is a fact rather than a link.
 */
function renderServices(ctx: RenderContext, stopIds: string[]): string {
  const feed = ctx.session.scheduledFeed!;
  const trips: Trip[] = [];
  for (const stopId of stopIds) {
    for (const tripId of feed.stopTrips.get(stopId) ?? []) {
      const trip = feed.trips.get(tripId);
      if (trip) trips.push(trip);
    }
  }

  const services = servicesForTrips(feed, trips);
  if (services.length === 0) return '';

  const shown = services.slice(0, CONFIG.SERVICE_LIST_MAX);
  const rows = shown.map(service =>
    entityRow(ctx, {
      label: service.id,
      sublabel: weekdaysLabel(service.days),
      ...(service.start && service.end ? { badge: `${service.start} to ${service.end}` } : {}),
    }),
  );

  return rowSection(
    'Service calendar',
    services.length,
    `${entityRowList(rows, '')}${cappedNote(services.length, shown.length)}`,
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function renderStopPage(
  ctx: RenderContext,
  rt: RtIndex,
  state: Extract<PageState, { type: 'stop' }>,
): string {
  const feed = ctx.session.scheduledFeed;
  const stop = feed?.stops.get(state.stop_id);
  if (!feed || !stop) return missing(`Stop ${state.stop_id}`);

  const parent = stop.parent_station ? feed.stops.get(stop.parent_station) : undefined;

  // A station aggregates over its boardable descendants; anything else answers
  // for itself. Include self in the service set so a plain stop still works and
  // a station that happens to carry its own stop_times is not dropped.
  const boardable = feed.boardableDescendants(stop.id);
  const isStation = boardable.length > 0;
  const serviceIds = isStation ? [...boardable, stop.id] : [stop.id];
  const alertIds = [stop.id, ...feed.descendants(stop.id)];

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        ${pageHeader(stop.name || stop.id, stop.id)}
        ${
          parent
            ? `<p class="text-xs">Part of ${entityLink(
                ctx,
                { type: 'stop', stop_id: parent.id },
                parent.name || parent.id,
              )}</p>`
            : ''
        }
      </div>

      ${
        isStation
          ? renderStationAlerts(ctx, alertIds)
          : renderAlertList(ctx, alertsForStop(ctx.session, stop.id), 'Alerts at this stop')
      }
      ${renderRoutes(ctx, serviceIds, isStation)}
      ${renderDepartures(ctx, rt, serviceIds, isStation)}
      ${renderTrackersHere(ctx, rt, serviceIds, isStation)}
      ${isStation ? renderPlatforms(ctx, stop.id) : renderSiblingPlatforms(ctx, stop)}
      ${renderServices(ctx, serviceIds)}

      ${section(
        'Properties',
        propList([
          prop('Coordinates', escHtml(`${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`)),
          prop('Trips calling', String((feed.stopTrips.get(stop.id) ?? []).length)),
        ]),
      )}
      ${renderRawFields('stops.txt', stop.raw)}
    </div>`;
}
