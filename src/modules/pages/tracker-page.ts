/**
 * The tracker page: what a tracker is called, what provisions it, and where it
 * is reporting from right now.
 *
 * yard-master's own page. test-track's vehicle page is the nearest thing, but
 * it describes an entity in somebody else's feed; a tracker is a row this app
 * created, and the half of the page that matters most has nothing to do with
 * GTFS-RT.
 *
 * `device_key` is the Traccar provisioning credential and the whole secret. It
 * is served by `GET /trackers/{id}` alone, it appears on this page and nowhere
 * else in the app, and it sits behind a closed disclosure so that opening a
 * tracker in front of somebody does not hand them the credential. Never put it
 * in the hash, a breadcrumb, a link or a log line. The provisioning dialog is
 * the same rule again: it is opened deliberately, by the surrogate id, and the
 * QR it shows encodes the credential just as plainly as the text does.
 */

import { CONFIG } from '../../config';
import type { Tracker } from '../../types/api';
import type { PageState } from '../../types/page-state';
import type { VehiclePosition } from '../../map-controller';
import type { RenderContext } from '../render-context';
import { entityRow, entityRowList, rowSection } from '../entity-row';
import {
  actionButton,
  describeRecurrence,
  formatWindow,
  livenessBadge,
  trackerLiveness,
} from '../managed-render';
import {
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  formatRelative,
  missing,
  prop,
  propList,
  section,
  timestampWithAge,
} from 'interlocking/gtfs/entity-render';

/**
 * The credential, behind a disclosure.
 *
 * `<details>` rather than a button because the panel re-renders on every
 * session event and `PanelRenderer` restores open disclosures by key — a
 * hand-rolled toggle would snap shut on the next tracker update. The key is
 * per-tracker, so opening one does not open the next one you navigate to.
 */
function renderDeviceKey(ctx: RenderContext, tracker: Tracker): string {
  const detail = ctx.session.trackerDetails.get(tracker.id);
  if (!detail) {
    return `<p class="text-xs opacity-60">Fetching the device key…</p>`;
  }
  return `
    <details class="text-xs rounded-lg border border-base-300 p-2"
             data-detail="device-key:${escHtml(tracker.id)}">
      <summary class="cursor-pointer font-medium">Show device key</summary>
      <p class="font-mono break-all mt-2 select-all">${escHtml(detail.device_key)}</p>
      <p class="opacity-60 mt-2">This is the Traccar identifier the phone or box is configured
      with. Anyone holding it can post positions as this tracker.</p>
    </details>`;
}

/**
 * A vehicle's location, as somewhere you can actually go.
 *
 * Google rather than a map link back into this app: this is the row somebody
 * reads when a bus is not where it should be and they are about to drive to it.
 */
function mapsLink(position: VehiclePosition): string {
  const query = `${position.lat.toFixed(6)},${position.lon.toFixed(6)}`;
  return `<a class="link break-all font-mono"
    href="${escHtml(`https://www.google.com/maps/search/?api=1&query=${query}`)}"
    target="_blank" rel="noopener">${escHtml(
      `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`
    )}</a>`;
}

/** One of the tracker's vehicles: where it is, and what it is running. */
export function renderVehicle(ctx: RenderContext, position: VehiclePosition): string {
  const feed = ctx.session.scheduledFeed;
  const routeId = position.routeId ?? (position.tripId ? feed?.trips.get(position.tripId)?.route_id : undefined);
  const route = routeId ? feed?.routes.get(routeId) : undefined;
  const stop = position.stopId ? feed?.stops.get(position.stopId) : undefined;

  return propList([
    prop('Reported', timestampWithAge(position.timestamp)),
    prop('Coordinates', mapsLink(position)),
    position.bearing === undefined ? '' : prop('Bearing', `${escHtml(String(Math.round(position.bearing)))}°`),
    position.speed === undefined
      ? ''
      : prop('Speed', `${escHtml((position.speed * 3.6).toFixed(1))} km/h`),
    position.tripId
      ? prop(
          'Trip',
          entityLink(
            ctx,
            { type: 'trip', trip_id: position.tripId, ...(routeId ? { route_id: routeId } : {}) },
            feed?.trips.get(position.tripId)?.headsign || position.tripId
          )
        )
      : prop('Trip', '<span class="opacity-40">unassigned</span>'),
    route
      ? prop(
          'Route',
          entityLink(
            ctx,
            { type: 'route', route_id: route.id },
            route.short_name || route.long_name || route.id
          )
        )
      : '',
    stop
      ? prop(
          `${VEHICLE_STATUS_LABELS[position.currentStatus ?? 2] ?? 'at'}`,
          entityLink(ctx, { type: 'stop', stop_id: stop.id }, stop.name || stop.id)
        )
      : '',
    // The service date of the trip being run, when the producer reports one.
    // Data about the trip, not part of what identifies the vehicle.
    position.startDate ? prop('Service date', escHtml(position.startDate)) : '',
  ]);
}

/**
 * Where the tracker is reporting from.
 *
 * *Every* vehicle it is reporting, not the first one found. One credential can
 * be carrying a whole fleet (a producer running fifty trains under one tracker
 * is the case this exists for), and a page that showed one of them would be
 * silently hiding the other forty-nine. A fleet is a list of rows, each opening
 * that vehicle's own page; a single vehicle is the tracker and is shown inline.
 */
function renderPosition(ctx: RenderContext, positions: VehiclePosition[]): string {
  if (positions.length === 0) {
    return section(
      'Position',
      `<p class="text-xs opacity-60">Not reporting. A tracker appears on the map once it
       has posted a fix, and drops off again after ${Math.round(
         CONFIG.TRACKER_STALE_MS / 1000
       )} seconds without one.</p>`
    );
  }

  if (positions.length === 1) {
    return section('Position', renderVehicle(ctx, positions[0]));
  }

  const feed = ctx.session.scheduledFeed;
  const rows = [...positions]
    .sort((a, b) => (a.label || a.vehicleId).localeCompare(b.label || b.vehicleId, undefined, { numeric: true }))
    .map((position) => {
      const trip = position.tripId ? feed?.trips.get(position.tripId) : undefined;
      const routeId = position.routeId ?? trip?.route_id;
      const route = routeId ? feed?.routes.get(routeId) : undefined;
      const sublabel = [route?.short_name || route?.long_name || routeId, trip?.headsign || position.tripId]
        .filter(Boolean)
        .join(' - ');
      const age =
        position.timestamp === undefined
          ? ''
          : `<span class="text-xs opacity-60 tabular-nums" data-since="${position.timestamp * 1000}">${escHtml(
              formatRelative(position.timestamp * 1000)
            )}</span>`;
      return entityRow(ctx, {
        state: { type: 'vehicle', tracker_id: position.trackerId, vehicle_key: position.key },
        label: position.label || position.vehicleId,
        ...(sublabel ? { sublabel } : {}),
        badgeHtml: age,
      });
    });

  return rowSection('Vehicles', positions.length, entityRowList(rows, ''));
}

/**
 * What this tracker is scheduled to run, as rules rather than as days.
 *
 * The standing arrangement is the tracker's own property; which dates it covers
 * is the calendar's question, and the link goes there. A trip the loaded
 * schedule has lost still lists, as its bare id: a feed can be reloaded out
 * from under a rule, and that is exactly when somebody needs to see it.
 */
function renderAssignments(ctx: RenderContext, trackerId: string): string {
  const session = ctx.session;
  if (!session.rules) {
    return section('Assignments', '<p class="text-xs opacity-60">Loading…</p>');
  }

  const rules = [...session.rules.values()].filter((r) => r.tracker_id === trackerId);
  const rows = rules.map((rule) => {
    const trip = session.scheduledFeed?.trips.get(rule.trip_id);
    return entityRow(ctx, {
      // A trip the loaded schedule has lost has no page, so the row is its
      // bare id rather than a link that would go nowhere.
      ...(trip ? { state: { type: 'trip' as const, trip_id: rule.trip_id, route_id: trip.route_id } } : {}),
      label: trip ? trip.raw.trip_short_name?.trim() || trip.headsign || rule.trip_id : rule.trip_id,
      sublabel: `${describeRecurrence(rule)} - ${formatWindow(rule.start_time, rule.end_time)}`,
      actionsHtml: `${actionButton('assign:edit', String(rule.id), 'Edit')}
        ${actionButton('assign:delete', String(rule.id), 'Delete', 'btn-outline btn-error')}`,
    });
  });

  return rowSection(
    'Assignments',
    rules.length,
    entityRowList(rows, 'This tracker is not assigned to anything.')
  );
}

export function renderTrackerPage(
  ctx: RenderContext,
  state: Extract<PageState, { type: 'tracker' }>
): string {
  const tracker = ctx.session.trackers.get(state.tracker_id);
  if (!tracker) {
    // An empty map is the list not having arrived, which is exactly what
    // `breadcrumbs.validateState` lets through; saying "not in the feed" for
    // one round trip contradicts it.
    if (ctx.session.trackers.size === 0) {
      return `<p class="text-sm opacity-60">Loading this feed's trackers…</p>`;
    }
    return missing(`Tracker ${state.tracker_id}`);
  }

  const positions = ctx.session.vehiclesFor(tracker.id);

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold leading-tight">${escHtml(tracker.nickname)}</h2>
        <p class="text-xs opacity-60 flex items-center gap-2">
          ${livenessBadge(trackerLiveness(ctx.session, tracker.id))}
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        ${actionButton('tracker:edit', tracker.id, 'Rename')}
        ${actionButton('tracker:delete', tracker.id, 'Delete', 'btn-outline btn-error')}
      </div>

      ${renderPosition(ctx, positions)}
      ${renderAssignments(ctx, tracker.id)}
      ${section(
        'Provisioning',
        `<div class="space-y-2">
          ${actionButton('tracker:provision', tracker.id, 'Show QR and link', 'btn-primary')}
          ${renderDeviceKey(ctx, tracker)}
        </div>`
      )}
    </div>`;
}
