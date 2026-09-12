/* @vendored-from test-track:src/modules/pages/alert-page.ts
   @sha 5570228
   @status modified
   @changes
   - `renderAlertPage` renders the *managed* alert, the row this app owns, from
     `session.serviceAlerts` and the entities `session.alertDetails` carries.
     test-track's decoded-entity page is kept below it as
     `renderRtAlertPage`, which is what a `PageState` naming an alert that is
     only in the live payload still falls back to.
   - An Affects section added: the API's `InformedEntity` rows, whose columns
     are flat where a GTFS-RT `EntitySelector` nests the trip half, each an
     `entity-row.ts` row linking the object it names and carrying a Remove
     button. The decoded-entity page below keeps test-track's own entity list,
     with no button, because nothing there is a row this app can write.
   - `renderAlertList`, which the route, stop and trip pages embed, renders
     through this repo's `entity-row.ts` so an alert row looks like every other
     row in the app. `statusBadge`, the translation and active-period renderers
     are test-track's, unchanged. */
/**
 * The alert page, plus the compact alert list every other page embeds.
 *
 * Two objects share this file and this `PageState` variant, which is worth
 * being explicit about. The *managed* alert is a row in cafe-car with a numeric
 * id, and it is what this app creates, browses and publishes. The `AlertRecord`
 * is what a consumer decoding the published feed sees. Here they are the same
 * disruption seen from two ends, so `alert_id` is `String(Alert.id)` and the
 * managed row is what the page shows.
 *
 * The one trap: cafe-car numbers the entities in the published GTFS-RT feed
 * positionally (`entity.id = str(i)`), so an `AlertRecord.id` is *not* an
 * `Alert.id`. Nothing fills `session.alerts` yet; whatever does has to key it
 * by the managed id, or the links the route and stop pages emit will point at
 * the wrong alert.
 */

import type { AlertRecord, ServiceAlert } from '../../gtfs-rt';
import type { Alert, InformedEntity } from '../../types/api';
import type { PageState } from '../../types/page-state';
import {
  ALERT_LEVEL_LABELS,
  CAUSE_LABELS,
  EFFECT_LABELS,
  SEVERITY_LABELS,
  activePeriods,
  alertLevel,
  isActiveNow,
  preferredText,
  selectorLevel,
  translations,
} from '../alerts';
import type { RenderContext } from '../render-utils';
import { emptyState, entityRow, entityRowList, rowSection } from '../entity-row';
import { actionButton, formatIso } from '../managed-render';
import {
  entityLink,
  escHtml,
  formatAbsolute,
  formatDuration,
  missing,
  pageHeader,
  prop,
  propList,
  renderRawJson,
  section,
} from '../render-utils';

type EntitySelector = NonNullable<ServiceAlert['informedEntity']>[number];

function statusBadge(record: AlertRecord): string {
  return isActiveNow(record.alert)
    ? '<span class="badge badge-warning badge-xs">active</span>'
    : '<span class="badge badge-ghost badge-xs">not active</span>';
}

/**
 * A list of alerts as one-line links. Used for the route page's alert regions,
 * the stop page, and the alerts modal, so they cannot drift apart.
 */
export function renderAlertList(
  ctx: RenderContext,
  records: AlertRecord[],
  title: string,
): string {
  if (records.length === 0) return '';
  return rowSection(
    title,
    records.length,
    entityRowList(
      records.map(record =>
        entityRow(ctx, {
          state: { type: 'alert', alert_id: record.id },
          leadHtml: statusBadge(record),
          label: preferredText(record.alert.headerText) || `Alert ${record.id}`,
          badge: ALERT_LEVEL_LABELS[alertLevel(record)],
        }),
      ),
      '',
    ),
  );
}

/** The languages the feed supplied beyond the one we chose to display. */
function renderOtherTranslations(label: string, ts: ServiceAlert['headerText']): string {
  const others = translations(ts).filter(t => t.text !== preferredText(ts));
  if (others.length === 0) return '';
  return `
    <details class="text-xs" data-detail="tr:${escHtml(label)}">
      <summary class="cursor-pointer opacity-60">${others.length} other translation${
        others.length === 1 ? '' : 's'
      }</summary>
      <dl class="mt-1 space-y-1">${others
        .map(
          t => `<div>
            <dt class="opacity-50 font-mono">${escHtml(t.language || '(no language)')}</dt>
            <dd class="whitespace-pre-wrap">${escHtml(t.text)}</dd>
          </div>`,
        )
        .join('')}</dl>
    </details>`;
}

/** Every language the feed supplied, not just the one we chose to display. */
function renderTranslations(label: string, ts: ServiceAlert['headerText']): string {
  const list = translations(ts);
  if (list.length === 0) return '';
  return `
    <div class="space-y-1">
      <p class="text-xs opacity-60">${escHtml(label)}</p>
      <p class="text-sm whitespace-pre-wrap">${escHtml(preferredText(ts))}</p>
      ${renderOtherTranslations(label, ts)}
    </div>`;
}

/**
 * The one-line version of the active periods, for the page header. The full
 * list is still rendered below in its own section.
 */
function activeWindow(alert: ServiceAlert): string {
  const periods = activePeriods(alert);
  if (periods.length === 0) return 'always active';

  const now = Date.now() / 1000;
  const current = periods.find(p => (p.start ?? -Infinity) <= now && (p.end ?? Infinity) >= now);
  const upcoming = periods.find(p => p.start !== undefined && p.start > now);

  let phrase: string;
  if (current) {
    phrase =
      current.end === undefined
        ? 'active, open-ended'
        : `active until ${formatAbsolute(current.end)}`;
  } else if (upcoming) {
    phrase = `starts ${formatAbsolute(upcoming.start!)}`;
  } else {
    const last = periods[periods.length - 1];
    phrase = last.end === undefined ? 'not active' : `ended ${formatAbsolute(last.end)}`;
  }

  return periods.length > 1 ? `${phrase}, ${periods.length} periods` : phrase;
}

/**
 * Active periods as absolute times plus what they mean right now. A period with
 * a start and no end is open-ended, and is said to be, rather than being
 * rendered with an end of 1970.
 */
function renderActivePeriods(alert: ServiceAlert): string {
  const periods = activePeriods(alert);
  if (periods.length === 0) {
    return `<p class="text-xs opacity-60">No active period given — the alert is always active.</p>`;
  }
  const now = Date.now() / 1000;
  return `<ul class="text-xs space-y-1">${periods
    .map(p => {
      const start = p.start === undefined ? 'always' : formatAbsolute(p.start);
      const end = p.end === undefined ? 'open-ended' : formatAbsolute(p.end);
      let note: string;
      if (p.start !== undefined && p.start > now) note = `starts in ${formatDuration(p.start - now)}`;
      else if (p.end !== undefined && p.end < now) note = `ended ${formatDuration(now - p.end)} ago`;
      else if (p.end !== undefined) note = `active, ends in ${formatDuration(p.end - now)}`;
      else note = 'active';
      return `<li class="flex justify-between gap-2">
        <span>${escHtml(start)} -&gt; ${escHtml(end)}</span>
        <span class="opacity-60 shrink-0">${escHtml(note)}</span>
      </li>`;
    })
    .join('')}</ul>`;
}

/** Each informed entity as links to the pages for the objects it names. */
function renderInformedEntity(ctx: RenderContext, e: EntitySelector): string {
  const feed = ctx.session.scheduledFeed;
  const links: string[] = [];

  if (e.agencyId) links.push(`<span class="opacity-60">agency</span> ${escHtml(e.agencyId)}`);
  if (e.routeType !== null && e.routeType !== undefined) {
    links.push(`<span class="opacity-60">route_type</span> ${escHtml(String(e.routeType))}`);
  }
  if (e.routeId) {
    const route = feed?.routes.get(e.routeId);
    links.push(
      `<span class="opacity-60">route</span> ${
        route
          ? entityLink(ctx, { type: 'route', route_id: route.id }, route.short_name || route.long_name || route.id)
          : escHtml(e.routeId)
      }`,
    );
  }
  if (e.stopId) {
    const stop = feed?.stops.get(e.stopId);
    links.push(
      `<span class="opacity-60">stop</span> ${
        stop ? entityLink(ctx, { type: 'stop', stop_id: stop.id }, stop.name || stop.id) : escHtml(e.stopId)
      }`,
    );
  }
  if (e.trip?.tripId) {
    const trip = feed?.trips.get(e.trip.tripId);
    links.push(
      `<span class="opacity-60">trip</span> ${escHtml(e.trip.tripId)}${
        trip
          ? ` <span class="opacity-60">on</span> ${entityLink(
              ctx,
              { type: 'route', route_id: trip.route_id },
              trip.route_id,
            )}`
          : ''
      }`,
    );
  }
  if (e.directionId !== null && e.directionId !== undefined) {
    links.push(`<span class="opacity-60">direction</span> ${escHtml(String(e.directionId))}`);
  }

  return `<li class="text-xs rounded border border-base-300 p-2 space-y-1">
    <span class="badge badge-ghost badge-xs">${escHtml(ALERT_LEVEL_LABELS[selectorLevel(e)])}</span>
    <div class="flex flex-wrap gap-x-3 gap-y-1">${
      links.length ? links.join('') : '<span class="opacity-50">names nothing — applies to the whole feed</span>'
    }</div>
  </li>`;
}

/** The managed alert's own window, which is one period rather than a list. */
function renderManagedWindow(alert: Alert): string {
  if (!alert.active_period_start && !alert.active_period_end) {
    return `<p class="text-xs opacity-60">No window set — the alert is published for as long as it exists.</p>`;
  }
  return propList([
    prop('From', escHtml(alert.active_period_start ? formatIso(alert.active_period_start) : 'always')),
    prop('Until', escHtml(alert.active_period_end ? formatIso(alert.active_period_end) : 'open-ended')),
  ]);
}

/**
 * One informed entity from the API, as a row pointing at what it names.
 *
 * The API's row is flat where GTFS-RT nests the trip descriptor, so the trip
 * half is `trip_id` / `trip_route_id` / `trip_start_date` rather than a `trip`
 * object. Everything it names is a string the feed's own author typed, and none
 * of it is validated against the zip, so an id that resolves becomes a link to
 * its page and one that does not is still shown as what was entered.
 *
 * The row links the most specific object it names — a trip over a route over a
 * stop — and everything else it says becomes the second line. That is the back
 * reference: the route page lists the alert, and this lists the route.
 */
function renderAffectedEntity(ctx: RenderContext, e: InformedEntity): string {
  // `alertId:entityId`: an entity is addressable only through its own alert,
  // which is how the server scopes the delete too.
  const arg = `${e.service_alert_id}:${e.id}`;
  const feed = ctx.session.scheduledFeed;

  const trip = e.trip_id ? feed?.trips.get(e.trip_id) : undefined;
  const route = e.route_id ? feed?.routes.get(e.route_id) : undefined;
  const stop = e.stop_id ? feed?.stops.get(e.stop_id) : undefined;

  let state: PageState | undefined;
  let label: string;
  if (trip) {
    state = { type: 'trip', trip_id: trip.trip_id, route_id: trip.route_id };
    label = trip.raw.trip_short_name?.trim() || trip.headsign || trip.trip_id;
  } else if (route) {
    state = { type: 'route', route_id: route.id };
    label = route.short_name || route.long_name || route.id;
  } else if (stop) {
    state = { type: 'stop', stop_id: stop.id };
    label = stop.name || stop.id;
  } else {
    label =
      e.trip_id ??
      e.route_id ??
      e.stop_id ??
      e.agency_id ??
      'The whole feed — this entity names nothing';
  }

  // Everything the row did not spend on its label, so a selector that names a
  // route *and* a direction still says both.
  const rest: string[] = [];
  if (e.agency_id && label !== e.agency_id) rest.push(`agency ${e.agency_id}`);
  if (e.route_type !== null) rest.push(`route_type ${e.route_type}`);
  if (route && !trip) rest.push(`route_id ${route.id}`);
  if (stop && (trip || route)) rest.push(`stop ${stop.name || stop.id}`);
  if (e.direction_id !== null) rest.push(`direction ${e.direction_id}`);
  if (trip && route) rest.push(`on ${route.short_name || route.long_name || route.id}`);
  if (e.trip_route_id && !route) rest.push(`trip route ${e.trip_route_id}`);
  if (e.trip_start_date) rest.push(e.trip_start_date);
  if (e.trip_start_time) rest.push(e.trip_start_time);

  // How broadly the entity applies, scored on the same selector rule the
  // decoded feed is scored on, so the two ends agree about a row's reach.
  const level = selectorLevel({
    ...(e.agency_id ? { agencyId: e.agency_id } : {}),
    ...(e.route_id ? { routeId: e.route_id } : {}),
    ...(e.route_type !== null ? { routeType: e.route_type } : {}),
    ...(e.stop_id ? { stopId: e.stop_id } : {}),
    ...(e.trip_id ? { trip: { tripId: e.trip_id } } : {}),
  });

  return entityRow(ctx, {
    ...(state ? { state } : {}),
    label,
    ...(rest.length ? { sublabel: rest.join(' - ') } : {}),
    badge: ALERT_LEVEL_LABELS[level],
    actionsHtml: actionButton('entity:delete', arg, 'Remove', 'btn-ghost'),
  });
}

/** What the alert informs, or the count while the detail request is in flight. */
function renderAffects(ctx: RenderContext, alert: Alert): string {
  const detail = ctx.session.alertDetails.get(String(alert.id));
  const empty = 'Nothing named — the alert applies to the whole feed.';
  if (!detail) {
    return alert.entity_count === 0
      ? emptyState(empty)
      : `<p class="text-xs opacity-60">Loading ${escHtml(String(alert.entity_count))} informed entit${
          alert.entity_count === 1 ? 'y' : 'ies'
        }…</p>`;
  }
  return entityRowList(
    detail.entities.map(e => renderAffectedEntity(ctx, e)),
    empty,
  );
}

/** Whether the managed alert's window contains this moment. */
function managedIsActive(alert: Alert, now = Date.now()): boolean {
  const start = alert.active_period_start ? Date.parse(alert.active_period_start) : null;
  const end = alert.active_period_end ? Date.parse(alert.active_period_end) : null;
  if (start !== null && now < start) return false;
  if (end !== null && now > end) return false;
  return true;
}

/** The managed alert: the row this app owns and publishes. */
function renderManagedAlertPage(ctx: RenderContext, alert: Alert): string {
  const active = managedIsActive(alert);
  return `
    <div class="space-y-4">
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          ${
            active
              ? '<span class="badge badge-warning badge-xs">active</span>'
              : '<span class="badge badge-ghost badge-xs">not active</span>'
          }
        </div>
        <h2 class="text-lg font-semibold leading-tight">${escHtml(alert.header_text)}</h2>
        <div class="flex flex-wrap gap-2">
          ${actionButton('alert:edit', String(alert.id), 'Edit')}
          ${actionButton('alert:delete', String(alert.id), 'Delete', 'btn-outline btn-error')}
        </div>
        ${
          alert.description_text
            ? `<p class="text-sm whitespace-pre-wrap">${escHtml(alert.description_text)}</p>`
            : ''
        }
        ${
          alert.url
            ? `<p class="text-xs"><a href="${escHtml(alert.url)}" target="_blank" rel="noopener"
                 class="link break-all">${escHtml(alert.url)}</a></p>`
            : ''
        }
      </div>

      ${section(
        'Properties',
        propList([
          prop('Cause', escHtml(alert.cause ?? '—')),
          prop('Effect', escHtml(alert.effect ?? '—')),
          prop('Severity', escHtml(alert.severity_level ?? '—')),
        ]),
      )}

      ${section('Active window', renderManagedWindow(alert))}
      ${rowSection(
        'Affects',
        alert.entity_count,
        `<div class="space-y-2">
          ${renderAffects(ctx, alert)}
          ${actionButton('entity:add', String(alert.id), 'Add entity')}
        </div>`
      )}
    </div>`;
}

export function renderAlertPage(
  ctx: RenderContext,
  state: Extract<PageState, { type: 'alert' }>,
): string {
  const managed = ctx.session.serviceAlerts.get(state.alert_id);
  if (managed) return renderManagedAlertPage(ctx, managed);

  // Not one of this feed's rows. It may still be in the live payload, which is
  // a different object with its own id space, so say which one is missing.
  const record = ctx.session.alerts.get(state.alert_id);
  if (!record) return missing(`Alert ${state.alert_id}`);
  return renderRtAlertPage(ctx, record);
}

/** test-track's page: the decoded GTFS-RT entity, as a consumer sees it. */
function renderRtAlertPage(ctx: RenderContext, record: AlertRecord): string {
  const alert = record.alert;
  const url = preferredText(alert.url);

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        ${pageHeader(preferredText(alert.headerText) || record.id, record.id)}
        ${renderOtherTranslations('Header', alert.headerText)}
      </div>

      ${alert.descriptionText ? renderTranslations('Description', alert.descriptionText) : ''}
      ${
        url
          ? `<p class="text-xs"><a href="${escHtml(url)}" target="_blank" rel="noopener" class="link">${escHtml(url)}</a></p>`
          : ''
      }

      ${section(
        'Properties',
        propList([
          prop('Status', `${statusBadge(record)} ${escHtml(activeWindow(alert))}`),
          prop('Level', escHtml(ALERT_LEVEL_LABELS[alertLevel(record)])),
          prop('Cause', escHtml(CAUSE_LABELS[alert.cause as number] ?? String(alert.cause ?? '—'))),
          prop('Effect', escHtml(EFFECT_LABELS[alert.effect as number] ?? String(alert.effect ?? '—'))),
          prop(
            'Severity',
            escHtml(SEVERITY_LABELS[alert.severityLevel as number] ?? String(alert.severityLevel ?? '—')),
          ),
        ]),
      )}

      ${section('Active periods', renderActivePeriods(alert))}

      ${section(
        'Informed entities',
        (alert.informedEntity ?? []).length
          ? `<ul class="space-y-1">${alert.informedEntity!
              .map(e => renderInformedEntity(ctx, e))
              .join('')}</ul>`
          : '<p class="text-xs opacity-60">No informed entities — the alert applies to the whole feed.</p>',
      )}

      ${renderRawJson('Alert (decoded)', record.raw)}
    </div>`;
}
