/**
 * The trip page: one trip's schedule, stop by stop, with whatever the live feed
 * predicts for it laid alongside, and the trackers assigned to run it.
 *
 * yard-master's own page. test-track has no trip page at all — it browses
 * route, stop, vehicle and alert — but the object hierarchy here runs
 * Route -> Trips -> Trip, because a trip is what a tracker is assigned to. Both
 * halves are here: the schedule and predictions the feeds carry, and the
 * assignment rules this app owns, which can be added from this page rather than
 * only from the calendar.
 *
 * Every clock time is rendered straight from the `stop_times` string. GTFS
 * times run past 24:00 on an overnight trip, so a `Date` round-trip would
 * silently rewrite 25:10:00 as 01:10 the wrong day.
 */

import type { Trip } from '../../gtfs-scheduled';
import type { PageState } from '../../types/page-state';
import { alertsForTrip } from '../alerts';
import { entityRow, entityRowList, rowSection } from '../entity-row';
import { actionButton, describeRecurrence, formatWindow } from '../managed-render';
import { zoneLabel } from '../feed-time';
import type { Prediction, RtIndex } from '../rt-index';
import { STRIP_ROW_CLASS } from 'interlocking/modules/route-strip';
import type { RenderContext } from '../render-utils';
import {
  entityLink,
  escHtml,
  formatDelay,
  formatEpochTime,
  formatScheduledTime,
  missing,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  section,
  vehicleDisplayName,
} from '../render-utils';
import { serviceCatalog, weekdaysLabel } from '../service-catalog';
import { renderAlertList } from './alert-page';

/**
 * When this trip runs: three read-only lines off the service it points at.
 *
 * A service is not an object this app browses — there is no page and no crumb
 * for one — so what a reader needs about it belongs here, on the trip that
 * names it: which service, which weekdays, and over what window.
 */
function renderService(ctx: RenderContext, trip: Trip): string {
  const feed = ctx.session.scheduledFeed!;
  const service = serviceCatalog(feed).get(trip.service_id);

  if (!service) {
    return section(
      'Service',
      `<p class="text-xs opacity-60">${escHtml(
        `This trip names service_id ${trip.service_id}, which is in neither calendar.txt nor calendar_dates.txt.`
      )}</p>`
    );
  }

  // No `calendar.txt` row means no window: the service runs on the dates
  // `calendar_dates.txt` adds and nowhere else, which "No weekly pattern"
  // already says.
  const window =
    service.start && service.end ? `${service.start} to ${service.end}` : 'No date range';

  return section(
    'Service',
    propList([
      prop('Service', `<span class="font-mono">${escHtml(service.id)}</span>`),
      prop('Runs', escHtml(weekdaysLabel(service.days))),
      prop('Window', escHtml(window)),
    ])
  );
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

function renderSchedule(ctx: RenderContext, rt: RtIndex, trip: Trip): string {
  const feed = ctx.session.scheduledFeed!;
  const times = feed.stopTimesByTrip.get(trip.trip_id) ?? [];
  if (times.length === 0) {
    return section(
      'Schedule',
      '<p class="text-xs opacity-60">This trip has no rows in stop_times.txt.</p>'
    );
  }

  // Predictions are keyed by stop, and a loop trip calls at the same stop
  // twice, so the sequence is what picks the right one where the producer gave
  // it. Where it did not, the first prediction for the stop is the best guess
  // available and matching by stop alone is what the strip does too.
  const predictions = rt.predictionsByTrip.get(trip.trip_id) ?? [];
  const bySequence = new Map<number, Prediction>();
  const byStop = new Map<string, Prediction>();
  for (const p of predictions) {
    if (p.stop_sequence !== undefined && !bySequence.has(p.stop_sequence)) {
      bySequence.set(p.stop_sequence, p);
    }
    if (!byStop.has(p.stop_id)) byStop.set(p.stop_id, p);
  }
  const live = predictions.length > 0;

  const rows = times
    .map((time) => {
      const stop = feed.stops.get(time.stop_id);
      const prediction = bySequence.get(time.stop_sequence) ?? byStop.get(time.stop_id);
      return `<tr class="${STRIP_ROW_CLASS}" data-stop-id="${escHtml(time.stop_id)}">
        <td class="opacity-50 tabular-nums text-right">${escHtml(String(time.stop_sequence))}</td>
        <td class="max-w-0 truncate">${entityLink(
          ctx,
          { type: 'stop', stop_id: time.stop_id },
          stop?.name || time.stop_id
        )}</td>
        <td class="text-right whitespace-nowrap tabular-nums opacity-60">${escHtml(
          formatScheduledTime(time.arrival_time || undefined, false)
        )}</td>
        <td class="text-right whitespace-nowrap tabular-nums opacity-60">${escHtml(
          formatScheduledTime(time.departure_time || undefined, false)
        )}</td>
        ${
          live
            ? `<td class="text-right whitespace-nowrap tabular-nums">${escHtml(
                formatEpochTime(prediction?.time, false)
              )}</td>
               <td class="text-right whitespace-nowrap">${formatDelay(prediction?.delay)}</td>`
            : ''
        }
      </tr>`;
    })
    .join('');

  return section(
    'Schedule',
    `<div class="overflow-x-auto"><table class="table table-xs">
       <thead><tr>
         <th class="text-right">#</th><th>Stop</th>
         <th class="text-right">Arr ${escHtml(zoneLabel())}</th>
         <th class="text-right">Dep ${escHtml(zoneLabel())}</th>
         ${
           live
             ? `<th class="text-right">Pred ${escHtml(zoneLabel())}</th>
                <th class="text-right">Delay</th>`
             : ''
         }
       </tr></thead>
       <tbody>${rows}</tbody>
     </table></div>`
  );
}

// ─── Trackers ─────────────────────────────────────────────────────────────────

/** Trackers reporting this trip right now, as opposed to assigned to it. */
function renderTrackers(ctx: RenderContext, rt: RtIndex, trip: Trip): string {
  const vehicles = rt.vehiclesByTrip.get(trip.trip_id) ?? [];
  if (vehicles.length === 0) return '';
  return rowSection(
    'Reporting this trip',
    vehicles.length,
    entityRowList(
      vehicles.map((v) =>
        entityRow(ctx, {
          // The tracker, not the vehicle: `key` is the tracker plus the trip
          // instance, and only `trackerId` addresses a page.
          state: { type: 'tracker', tracker_id: v.trackerId },
          label: vehicleDisplayName(ctx.session.scheduledFeed, v),
        })
      ),
      'Nothing is reporting this trip.'
    )
  );
}

/**
 * Who is assigned to run this trip, and the way to assign somebody.
 *
 * Rules rather than expanded days: this is the standing arrangement, and which
 * particular dates it covers is the calendar's question. The section renders
 * even with nothing in it, because "nothing is assigned to this trip" is the
 * answer somebody opened the page for.
 */
function renderAssignments(ctx: RenderContext, trip: Trip): string {
  const session = ctx.session;
  if (!session.rules) {
    return section('Assignments', '<p class="text-xs opacity-60">Loading…</p>');
  }

  const rules = session.rulesForTrip(trip.trip_id);
  const rows = rules.map((rule) => {
    const tracker = session.trackers.get(rule.tracker_id);
    return entityRow(ctx, {
      ...(tracker ? { state: { type: 'tracker' as const, tracker_id: tracker.id } } : {}),
      label: tracker ? tracker.nickname : rule.tracker_id,
      sublabel: `${describeRecurrence(rule)} - ${formatWindow(rule.start_time, rule.end_time)}`,
      actionsHtml: `${actionButton('assign:edit', String(rule.id), 'Edit')}
        ${actionButton('assign:delete', String(rule.id), 'Delete', 'btn-outline btn-error')}`,
    });
  });

  return rowSection(
    'Assignments',
    rules.length,
    `${entityRowList(rows, 'No tracker is assigned to this trip.')}
     <div class="mt-2">${actionButton(
       'assign:new-for-trip',
       trip.trip_id,
       'Assign a tracker'
     )}</div>`
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function renderTripPage(
  ctx: RenderContext,
  rt: RtIndex,
  state: Extract<PageState, { type: 'trip' }>
): string {
  const feed = ctx.session.scheduledFeed;
  const trip = feed?.trips.get(state.trip_id);
  if (!feed || !trip) return missing(`Trip ${state.trip_id}`);

  const route = feed.routes.get(trip.route_id);
  const shape = feed.shapes.get(trip.shape_id);
  const shortName = trip.raw.trip_short_name?.trim();

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        ${route ? `<div class="flex items-center gap-2">${routeBadge(ctx, route)}</div>` : ''}
        <h2 class="text-lg font-semibold leading-tight">${escHtml(
          shortName || trip.headsign || trip.trip_id
        )}</h2>
        ${
          shortName && trip.headsign
            ? `<p class="text-xs opacity-60">${escHtml(trip.headsign)}</p>`
            : ''
        }
        <p class="text-xs opacity-60 font-mono">${escHtml(trip.trip_id)}</p>
      </div>

      ${renderAlertList(ctx, alertsForTrip(ctx.session, trip.trip_id, trip.route_id), 'Alerts')}
      ${renderTrackers(ctx, rt, trip)}
      ${renderSchedule(ctx, rt, trip)}
      ${renderService(ctx, trip)}
      ${renderAssignments(ctx, trip)}

      ${section(
        'Properties',
        propList([
          prop(
            'Route',
            route
              ? entityLink(
                  ctx,
                  { type: 'route', route_id: route.id },
                  route.short_name || route.long_name || route.id
                )
              : escHtml(trip.route_id)
          ),
          prop('direction_id', escHtml(trip.direction_id || '(none)')),
          prop(
            'Shape',
            trip.shape_id
              ? escHtml(`${trip.shape_id} (${shape?.length ?? 0} points)`)
              : '<span class="opacity-40">none</span>'
          ),
        ])
      )}
      ${renderRawFields('trips.txt', trip.raw)}
    </div>`;
}
