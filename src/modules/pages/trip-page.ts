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

import type { Calendar, CalendarDate, Trip } from '../../gtfs-static';
import type { PageState } from '../../types/page-state';
import { alertsForTrip } from '../alerts';
import { entityRow, entityRowList, rowSection } from '../entity-row';
import { actionButton, describeRecurrence, formatWindow } from '../managed-render';
import { zoneLabel } from '../feed-time';
import type { Prediction, RtIndex } from '../rt-index';
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
import { renderAlertList } from './alert-page';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "2024-03-01" from the GTFS "20240301", which is the only form the zip has. */
function formatServiceDate(date: string): string {
  return /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : date;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * What days the trip runs, from `calendar.txt` and `calendar_dates.txt`.
 *
 * A feed may use either file alone: a service with no `calendar` row runs only
 * on the dates `calendar_dates` adds, so an absent row is reported rather than
 * treated as "runs every day".
 */
function renderService(
  trip: Trip,
  calendar: Calendar | undefined,
  exceptions: CalendarDate[],
): string {
  const days = calendar
    ? DAY_LABELS.filter((_, i) => calendar.days[i]).join(', ') || 'no weekdays'
    : '';

  const added = exceptions.filter((d) => d.exception_type === 1);
  const removed = exceptions.filter((d) => d.exception_type === 2);

  const dateList = (label: string, dates: CalendarDate[]): string =>
    dates.length === 0
      ? ''
      : `<details class="text-xs" data-detail="svc:${escHtml(label)}">
           <summary class="cursor-pointer opacity-60">${escHtml(
             `${dates.length} ${label}`
           )}</summary>
           <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">${dates
             .map((d) => `<li>${escHtml(formatServiceDate(d.date))}</li>`)
             .join('')}</ul>
         </details>`;

  return section(
    'Service',
    `${propList([
      prop('service_id', `<span class="font-mono">${escHtml(trip.service_id)}</span>`),
      calendar
        ? prop('Runs', escHtml(days))
        : prop(
            'Runs',
            '<span class="opacity-60">no calendar.txt row — only the added dates below</span>'
          ),
      calendar
        ? prop(
            'Window',
            escHtml(
              `${formatServiceDate(calendar.start_date)} to ${formatServiceDate(calendar.end_date)}`
            )
          )
        : '',
    ])}
     ${dateList('added dates', added)}
     ${dateList('removed dates', removed)}`
  );
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

function renderSchedule(ctx: RenderContext, rt: RtIndex, trip: Trip): string {
  const feed = ctx.session.staticFeed!;
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
      return `<tr>
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
          label: vehicleDisplayName(ctx.session.staticFeed, v),
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
      sublabel: `${describeRecurrence(rule)} · ${formatWindow(rule.start_time, rule.end_time)}`,
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
  const feed = ctx.session.staticFeed;
  const trip = feed?.trips.get(state.trip_id);
  if (!feed || !trip) return missing(`Trip ${state.trip_id}`);

  const route = feed.routes.get(trip.route_id);
  const calendar = feed.calendar.find((c) => c.service_id === trip.service_id);
  const exceptions = feed.calendarDates.filter((d) => d.service_id === trip.service_id);
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
      ${renderAssignments(ctx, trip)}
      ${renderService(trip, calendar, exceptions)}
      ${renderSchedule(ctx, rt, trip)}

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
