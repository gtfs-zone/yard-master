/**
 * The tracker page: what a tracker is called, what provisions it, and where it
 * last reported from.
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
import type { RenderContext } from '../render-utils';
import { actionButton } from '../managed-render';
import {
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  missing,
  prop,
  propList,
  section,
  timestampWithAge,
} from '../render-utils';

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

/** Where the tracker last reported from, if it has ever reported. */
function renderPosition(ctx: RenderContext, position: VehiclePosition | undefined): string {
  if (!position) {
    return section(
      'Position',
      `<p class="text-xs opacity-60">No position reported. A tracker appears on the map once it
       has posted a fix, and drops off again after ${Math.round(
         CONFIG.TRACKER_STALE_MS / 1000
       )} seconds without one.</p>`
    );
  }

  const feed = ctx.session.staticFeed;
  const routeId = position.routeId ?? (position.tripId ? feed?.trips.get(position.tripId)?.route_id : undefined);
  const route = routeId ? feed?.routes.get(routeId) : undefined;
  const stop = position.stopId ? feed?.stops.get(position.stopId) : undefined;

  return section(
    'Position',
    propList([
      prop('Reported', timestampWithAge(position.timestamp)),
      prop(
        'Coordinates',
        `<span class="font-mono">${escHtml(position.lat.toFixed(5))}, ${escHtml(
          position.lon.toFixed(5)
        )}</span>`
      ),
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
    ])
  );
}

export function renderTrackerPage(
  ctx: RenderContext,
  state: Extract<PageState, { type: 'tracker' }>
): string {
  const tracker = ctx.session.trackers.get(state.tracker_id);
  if (!tracker) {
    // The list is fetched on selection, so an id that misses is a tracker that
    // was deleted or belongs to another feed, not one that has not arrived.
    return missing(`Tracker ${state.tracker_id}`);
  }

  const position = ctx.session.vehicles.get(tracker.id);

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold leading-tight">${escHtml(tracker.nickname)}</h2>
        <p class="text-xs opacity-60">
          ${position ? 'Reporting' : 'No fix'} ·
          ${entityLink(ctx, { type: 'assignments' }, 'Assignments')}
        </p>
      </div>

      <div class="flex flex-wrap gap-2">
        ${actionButton('tracker:edit', tracker.id, 'Rename')}
        ${actionButton('tracker:delete', tracker.id, 'Delete', 'btn-outline btn-error')}
      </div>

      ${renderPosition(ctx, position)}
      ${section(
        'Provisioning',
        `<div class="space-y-2">
          ${actionButton('tracker:provision', tracker.id, 'Show QR and link', 'btn-primary')}
          ${renderDeviceKey(ctx, tracker)}
        </div>`
      )}

      ${section(
        'Properties',
        propList([
          prop('Nickname', escHtml(tracker.nickname)),
          prop('Id', `<span class="font-mono break-all">${escHtml(tracker.id)}</span>`),
        ])
      )}
    </div>`;
}
