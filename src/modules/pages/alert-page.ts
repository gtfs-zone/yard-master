/* @vendored-from test-track:src/modules/pages/alert-page.ts
   @sha fa12a57
   @status modified
   @changes
   - `renderAlertPage` renders the *managed* alert, the row this app owns, from
     `session.serviceAlerts` and the entities `session.alertDetails` carries.
     test-track's decoded-entity page is kept below it as
     `renderRtAlertPage`, which is what a `PageState` naming an alert that is
     only in the live payload still falls back to.
   - `renderManagedEntity` added: an `InformedEntity` row from the API, whose
     columns are flat where a GTFS-RT `EntitySelector` nests the trip half. It
     carries a Remove button; the decoded-entity page below has none, because
     nothing there is a row this app can write.
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
import { entityRow, entityRowList, rowSection } from '../entity-row';
import { actionButton, formatIso } from '../managed-render';
import {
  entityLink,
  escHtml,
  formatAbsolute,
  formatDuration,
  missing,
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

/** Every language the feed supplied, not just the one we chose to display. */
function renderTranslations(label: string, ts: ServiceAlert['headerText']): string {
  const list = translations(ts);
  if (list.length === 0) return '';
  const preferred = preferredText(ts);
  const others = list.filter(t => t.text !== preferred);
  return `
    <div class="space-y-1">
      <p class="text-xs opacity-60">${escHtml(label)}</p>
      <p class="text-sm whitespace-pre-wrap">${escHtml(preferred)}</p>
      ${
        others.length
          ? `<details class="text-xs" data-detail="tr:${escHtml(label)}">
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
             </details>`
          : ''
      }
    </div>`;
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
  const feed = ctx.session.staticFeed;
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
 * One informed entity from the API, linked to the pages for what it names.
 *
 * The API's row is flat where GTFS-RT nests the trip descriptor, so the trip
 * half is `trip_id` / `trip_route_id` / `trip_start_date` rather than a
 * `trip` object. Everything it names is a string the feed's own author typed,
 * and none of it is validated against the zip, so an id that resolves gets a
 * link and one that does not is still shown as what was entered.
 */
function renderManagedEntity(ctx: RenderContext, e: InformedEntity): string {
  // `alertId:entityId`: an entity is addressable only through its own alert,
  // which is how the server scopes the delete too.
  const arg = `${e.service_alert_id}:${e.id}`;
  const feed = ctx.session.staticFeed;
  const parts: string[] = [];

  const add = (label: string, valueHtml: string): void => {
    parts.push(`<span class="opacity-60">${escHtml(label)}</span> ${valueHtml}`);
  };

  if (e.agency_id) add('agency', escHtml(e.agency_id));
  if (e.route_type !== null) add('route_type', escHtml(String(e.route_type)));
  if (e.route_id) {
    const route = feed?.routes.get(e.route_id);
    add(
      'route',
      route
        ? entityLink(ctx, { type: 'route', route_id: route.id }, route.short_name || route.long_name || route.id)
        : escHtml(e.route_id),
    );
  }
  if (e.stop_id) {
    const stop = feed?.stops.get(e.stop_id);
    add('stop', stop ? entityLink(ctx, { type: 'stop', stop_id: stop.id }, stop.name || stop.id) : escHtml(e.stop_id));
  }
  if (e.direction_id !== null) add('direction', escHtml(String(e.direction_id)));
  if (e.trip_id) {
    const trip = feed?.trips.get(e.trip_id);
    add(
      'trip',
      trip
        ? entityLink(ctx, { type: 'trip', trip_id: trip.trip_id, route_id: trip.route_id }, trip.headsign || trip.trip_id)
        : escHtml(e.trip_id),
    );
  }
  if (e.trip_route_id) add('trip route', escHtml(e.trip_route_id));
  if (e.trip_start_date) add('start date', escHtml(e.trip_start_date));
  if (e.trip_start_time) add('start time', escHtml(e.trip_start_time));

  return `<li class="text-xs rounded border border-base-300 p-2 flex items-start gap-2">
    <div class="flex flex-wrap gap-x-3 gap-y-1 flex-1 min-w-0">${
      parts.length ? parts.join('') : '<span class="opacity-50">names nothing — applies to the whole feed</span>'
    }</div>
    ${actionButton('entity:delete', arg, 'Remove', 'btn-ghost')}
  </li>`;
}

/** The informed entities, or the count while the detail request is in flight. */
function renderManagedEntities(ctx: RenderContext, alert: Alert): string {
  const detail = ctx.session.alertDetails.get(String(alert.id));
  if (!detail) {
    return alert.entity_count === 0
      ? '<p class="text-xs opacity-60">No informed entities — the alert applies to the whole feed.</p>'
      : `<p class="text-xs opacity-60">Loading ${escHtml(String(alert.entity_count))} informed entit${
          alert.entity_count === 1 ? 'y' : 'ies'
        }…</p>`;
  }
  if (detail.entities.length === 0) {
    return '<p class="text-xs opacity-60">No informed entities — the alert applies to the whole feed.</p>';
  }
  return `<ul class="space-y-1">${detail.entities.map(e => renderManagedEntity(ctx, e)).join('')}</ul>`;
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
      ${section(
        'Informed entities',
        `<div class="space-y-2">
          ${renderManagedEntities(ctx, alert)}
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
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          ${statusBadge(record)}
          <span class="text-xs opacity-60">${escHtml(ALERT_LEVEL_LABELS[alertLevel(record)])}</span>
        </div>
        ${renderTranslations('Header', alert.headerText)}
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
          prop('Entity id', `<span class="font-mono">${escHtml(record.id)}</span>`),
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
