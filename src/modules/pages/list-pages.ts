/**
 * The four list pages: Routes, Stops, Trackers and Service alerts.
 *
 * yard-master's own pages. Each of these was a `<details>` section on the feed
 * page, capped at 200 rows with a note pointing at the search box. They
 * are pages now, so a list is complete rather than a preview of itself, and the
 * create button sits on the list it creates into rather than inside a
 * disclosure somebody has to open first.
 *
 * One file because they are the same page four times: a title with a count, a
 * create button where the API has one, and a list of `entity-row.ts` rows. The
 * only thing that differs is where the rows come from — Trackers and Alerts
 * come from the API and render the moment a feed is selected, while Routes and
 * Stops come from the zip this browser is still parsing, which is why only
 * those two carry a schedule-status line.
 */

import { CONFIG } from '../../config';
import type { Stop } from '../../gtfs-static';
import type { RenderContext } from '../render-utils';
import { escHtml, routeBadge } from '../render-utils';
import { cappedNote, countBadge, entityRow, entityRowList } from '../entity-row';
import { actionButton, livenessBadge, trackerLiveness } from '../managed-render';
import { routeSortKey } from '../route-sort';

/** The title line every list page shares: name, count, and what creates one. */
function listHeader(title: string, count: number | string, actionsHtml = ''): string {
  return `
    <div class="flex items-center gap-2">
      <h2 class="text-lg font-semibold leading-tight">${escHtml(title)}</h2>
      ${countBadge(count)}
      ${actionsHtml ? `<span class="ml-auto flex gap-2">${actionsHtml}</span>` : ''}
    </div>`;
}

/**
 * Where the zip is up to, for the two pages built out of it.
 *
 * A route or stop page opened before the zip has parsed says the schedule is
 * still downloading. That is a different fact from an empty feed, and a list
 * that showed its empty state instead would be claiming the feed has no stops.
 */
function scheduleStatus(ctx: RenderContext): string {
  const session = ctx.session;
  if (session.staticError) {
    return `<div class="alert alert-warning alert-sm text-xs">
      <span>The static feed did not load: ${escHtml(session.staticError)}</span>
    </div>`;
  }
  if (!session.staticFeed) return `<p class="text-xs opacity-60">Downloading the schedule…</p>`;
  return '';
}

export function renderRoutesPage(ctx: RenderContext): string {
  const feed = ctx.session.staticFeed;
  if (!feed) return `<div class="space-y-4">${listHeader('Routes', 0)}${scheduleStatus(ctx)}</div>`;

  const routes = [...feed.routes.values()].sort((a, b) => {
    // Same key the map paints by, so the panel's order and the map's stacking
    // agree about which routes are the important ones. Descending: the highest
    // key paints on top and reads first.
    const keyA = routeSortKey(a.raw.route_type, (feed.tripsByRoute.get(a.id) ?? []).length);
    const keyB = routeSortKey(b.raw.route_type, (feed.tripsByRoute.get(b.id) ?? []).length);
    if (keyA !== keyB) return keyB - keyA;
    return (a.short_name || a.long_name || a.id).localeCompare(b.short_name || b.long_name || b.id);
  });

  const rows = routes.map((route) => {
    const trips = (feed.tripsByRoute.get(route.id) ?? []).length;
    return entityRow(ctx, {
      state: { type: 'route', route_id: route.id },
      // The badge already carries the route's colour, so the row's dot would
      // say the same thing twice.
      leadHtml: routeBadge(ctx, route),
      label: route.long_name || route.short_name || route.id,
      badge: `${trips} trip${trips === 1 ? '' : 's'}`,
    });
  });

  return `
    <div class="space-y-4">
      ${listHeader('Routes', routes.length)}
      ${entityRowList(rows, 'No routes in this feed.')}
    </div>`;
}

/**
 * Stops, one row per *place*. A station's platforms hang off its own page, so
 * listing them here would bury the places under their own parts.
 *
 * The one list page that keeps a cap. A large feed has tens of thousands of
 * places, and the panel re-renders on every realtime poll: rebuilding that many
 * rows every fifteen seconds is not a list somebody can use.
 */
export function renderStopsPage(ctx: RenderContext): string {
  const feed = ctx.session.staticFeed;
  if (!feed) return `<div class="space-y-4">${listHeader('Stops', 0)}${scheduleStatus(ctx)}</div>`;

  const places: Stop[] = [...feed.stops.values()].filter((s) => !s.parent_station);
  places.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  const shown = places.slice(0, CONFIG.STOP_LIST_MAX);
  const rows = shown.map((stop) => {
    const children = feed.descendants(stop.id).length;
    return entityRow(ctx, {
      state: { type: 'stop', stop_id: stop.id },
      label: stop.name || stop.id,
      sublabel: stop.name ? stop.id : undefined,
      ...(children ? { badge: `${children} platform${children === 1 ? '' : 's'}` } : {}),
    });
  });

  return `
    <div class="space-y-4">
      ${listHeader('Stops', places.length)}
      ${entityRowList(rows, 'No stops in this feed.')}
      ${cappedNote(places.length, shown.length)}
    </div>`;
}

export function renderTrackersPage(ctx: RenderContext): string {
  // Every tracker is listed, reporting or not. A tracker with no fix has no
  // coordinates and so is not on the map at all, which makes this list the only
  // place it exists — and seeing which ones are idle is how you decide what to
  // assign.
  const trackers = [...ctx.session.trackers.values()].sort((a, b) =>
    a.nickname.localeCompare(b.nickname)
  );

  const rows = trackers.map((tracker) =>
    entityRow(ctx, {
      state: { type: 'tracker', tracker_id: tracker.id },
      label: tracker.nickname,
      badgeHtml: livenessBadge(trackerLiveness(ctx.session, tracker.id)),
    })
  );

  return `
    <div class="space-y-4">
      ${listHeader('Trackers', trackers.length, actionButton('tracker:new', '', 'New tracker'))}
      ${entityRowList(rows, 'No trackers yet.')}
    </div>`;
}

export function renderAlertsPage(ctx: RenderContext): string {
  const alerts = [...ctx.session.serviceAlerts.values()].sort((a, b) => b.id - a.id);

  const rows = alerts.map((alert) =>
    entityRow(ctx, {
      state: { type: 'alert', alert_id: String(alert.id) },
      label: alert.header_text || `Alert ${alert.id}`,
      badge: `${alert.entity_count} entit${alert.entity_count === 1 ? 'y' : 'ies'}`,
    })
  );

  return `
    <div class="space-y-4">
      ${listHeader('Service alerts', alerts.length, actionButton('alert:new', '', 'New alert'))}
      ${entityRowList(rows, 'No service alerts.')}
    </div>`;
}
