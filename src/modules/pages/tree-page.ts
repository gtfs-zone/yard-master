/**
 * The browse tree: the panel's home page, and the way into every object that
 * has no map feature to click.
 *
 * yard-master's own page. test-track shows a feed status page here; this repo
 * is a manager, so the no-focus page is a hierarchy instead. The managed half
 * (trackers, assignments, alerts, people) sits above the divider and comes from
 * the API; the GTFS half below it comes from the in-browser zip. The two are
 * independent: the managed half renders the moment a feed is selected, while
 * the zip is still downloading, or never arrives at all.
 *
 * Section bodies are `<details>` so the panel renderer's open-detail tracking
 * survives a re-render. Long sections are capped: a large feed has tens of
 * thousands of stops, and paging through them is what the search box is for.
 */

import { CONFIG } from '../../config';
import type { Stop } from '../../gtfs-static';
import type { PageState } from '../../types/page-state';
import type { RenderContext } from '../render-utils';
import { entityLink, escHtml, routeBadge } from '../render-utils';
import { routeSortKey } from '../route-sort';

/** A collapsible section: a header with a count, and a list under it. */
function treeSection(key: string, title: string, count: number, body: string): string {
  return `
    <details class="rounded-lg border border-base-300" data-detail="tree:${escHtml(key)}">
      <summary class="cursor-pointer px-3 py-2 text-sm font-semibold flex justify-between gap-2">
        <span>${escHtml(title)}</span>
        <span class="opacity-50 tabular-nums font-normal">${escHtml(String(count))}</span>
      </summary>
      <div class="px-3 pb-3">${body}</div>
    </details>`;
}

/** The "not everything is listed" line, shown only when something was cut. */
function cappedNote(total: number, shown: number): string {
  if (total <= shown) return '';
  return `<p class="text-xs opacity-50 mt-2">${escHtml(
    `${total - shown} more not listed — use the search box.`
  )}</p>`;
}

function renderRoutes(ctx: RenderContext): string {
  const feed = ctx.session.staticFeed!;
  const routes = [...feed.routes.values()].sort((a, b) => {
    // Same key the map paints by, so the panel's order and the map's stacking
    // agree about which routes are the important ones. Descending: the highest
    // key paints on top and reads first.
    const keyA = routeSortKey(a.raw.route_type, (feed.tripsByRoute.get(a.id) ?? []).length);
    const keyB = routeSortKey(b.raw.route_type, (feed.tripsByRoute.get(b.id) ?? []).length);
    if (keyA !== keyB) return keyB - keyA;
    return (a.short_name || a.long_name || a.id).localeCompare(b.short_name || b.long_name || b.id);
  });

  const shown = routes.slice(0, CONFIG.TREE_LIST_MAX);
  const rows = shown
    .map(
      (route) => `<li class="flex items-center gap-2 min-w-0">
        ${routeBadge(ctx, route)}
        <span class="min-w-0 truncate">${entityLink(
          ctx,
          { type: 'route', route_id: route.id },
          route.long_name || route.short_name || route.id
        )}</span>
        <span class="ml-auto opacity-50 tabular-nums shrink-0">${escHtml(
          String((feed.tripsByRoute.get(route.id) ?? []).length)
        )}</span>
      </li>`
    )
    .join('');

  return treeSection(
    'routes',
    'Routes',
    routes.length,
    `<ul class="space-y-1 text-xs">${rows}</ul>${cappedNote(routes.length, shown.length)}`
  );
}

/**
 * Stops, one row per *place*. A station's platforms hang off its own page, so
 * listing them here would bury the places under their own parts.
 */
function renderStops(ctx: RenderContext): string {
  const feed = ctx.session.staticFeed!;
  const places: Stop[] = [...feed.stops.values()].filter((s) => !s.parent_station);
  places.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  const shown = places.slice(0, CONFIG.TREE_LIST_MAX);
  const rows = shown
    .map((stop) => {
      const children = feed.descendants(stop.id).length;
      return `<li class="flex items-center gap-2 min-w-0">
        <span class="min-w-0 truncate">${entityLink(
          ctx,
          { type: 'stop', stop_id: stop.id },
          stop.name || stop.id
        )}</span>
        ${
          children
            ? `<span class="ml-auto opacity-50 tabular-nums shrink-0">${escHtml(
                `${children} platform${children === 1 ? '' : 's'}`
              )}</span>`
            : ''
        }
      </li>`;
    })
    .join('');

  return treeSection(
    'stops',
    'Stops',
    places.length,
    `<ul class="space-y-1 text-xs">${rows}</ul>${cappedNote(places.length, shown.length)}`
  );
}

// ─── The managed half ────────────────────────────────────────────────────────

/** A section that is one link rather than a list: no count, no disclosure. */
function treeLink(ctx: RenderContext, state: PageState, title: string, note: string): string {
  return `
    <div class="rounded-lg border border-base-300 px-3 py-2 text-sm font-semibold flex justify-between gap-2">
      ${entityLink(ctx, state, title, 'link link-hover')}
      <span class="opacity-50 font-normal text-xs self-center">${escHtml(note)}</span>
    </div>`;
}

function renderTrackers(ctx: RenderContext): string {
  const trackers = [...ctx.session.trackers.values()].sort((a, b) =>
    a.nickname.localeCompare(b.nickname)
  );
  const shown = trackers.slice(0, CONFIG.TREE_LIST_MAX);
  const rows = shown
    .map((tracker) => {
      // A tracker with a fix is in `vehicles`, keyed by the same id the map
      // paints it under; one without has simply never reported.
      const live = ctx.session.vehicles.has(tracker.id);
      return `<li class="flex items-center gap-2 min-w-0">
        <span class="min-w-0 truncate">${entityLink(
          ctx,
          { type: 'tracker', tracker_id: tracker.id },
          tracker.nickname
        )}</span>
        <span class="ml-auto shrink-0 badge badge-xs ${
          live ? 'badge-success' : 'badge-ghost'
        }">${escHtml(live ? 'reporting' : 'no fix')}</span>
      </li>`;
    })
    .join('');

  return treeSection(
    'trackers',
    'Trackers',
    trackers.length,
    trackers.length
      ? `<ul class="space-y-1 text-xs">${rows}</ul>${cappedNote(trackers.length, shown.length)}`
      : '<p class="text-xs opacity-60">No trackers yet.</p>'
  );
}

function renderAlerts(ctx: RenderContext): string {
  const alerts = [...ctx.session.serviceAlerts.values()].sort((a, b) => b.id - a.id);
  const shown = alerts.slice(0, CONFIG.TREE_LIST_MAX);
  const rows = shown
    .map(
      (alert) => `<li class="flex items-center gap-2 min-w-0">
        <span class="min-w-0 truncate">${entityLink(
          ctx,
          { type: 'alert', alert_id: String(alert.id) },
          alert.header_text || `Alert ${alert.id}`
        )}</span>
        <span class="ml-auto opacity-50 tabular-nums shrink-0">${escHtml(
          `${alert.entity_count} entit${alert.entity_count === 1 ? 'y' : 'ies'}`
        )}</span>
      </li>`
    )
    .join('');

  return treeSection(
    'alerts',
    'Service alerts',
    alerts.length,
    alerts.length
      ? `<ul class="space-y-1 text-xs">${rows}</ul>${cappedNote(alerts.length, shown.length)}`
      : '<p class="text-xs opacity-60">No service alerts.</p>'
  );
}

function renderManaged(ctx: RenderContext): string {
  const people = ctx.session.people;
  const peopleNote = people
    ? `${people.members.length} member${people.members.length === 1 ? '' : 's'}${
        people.invites.length ? `, ${people.invites.length} invited` : ''
      }`
    : '';
  return `
    ${renderTrackers(ctx)}
    ${treeLink(ctx, { type: 'assignments' }, 'Assignments', '')}
    ${renderAlerts(ctx)}
    ${treeLink(ctx, { type: 'people' }, 'People', peopleNote)}`;
}

/**
 * Where the zip is up to. The managed half of the tree works without it, so
 * "still downloading" and "did not load" are states the tree renders in, not
 * reasons to render nothing.
 */
function renderStaticStatus(ctx: RenderContext): string {
  const session = ctx.session;
  if (session.staticError) {
    return `<div class="alert alert-warning alert-sm text-xs">
      <span>The static feed did not load: ${escHtml(session.staticError)}</span>
    </div>`;
  }
  if (!session.staticFeed) {
    return `<p class="text-xs opacity-60">Downloading the schedule…</p>`;
  }
  return '';
}

export function renderTreePage(ctx: RenderContext): string {
  const session = ctx.session;
  if (!session.feed) {
    return '<p class="text-base-content/50 text-sm text-center py-8">No feed selected</p>';
  }

  const feedState: PageState = { type: 'feed' };
  const gtfs = session.staticFeed
    ? `${renderRoutes(ctx)}${renderStops(ctx)}`
    : '';

  return `
    <div class="space-y-3">
      <h2 class="text-lg font-semibold leading-tight">${entityLink(
        ctx,
        feedState,
        session.feed.feed_name,
        'link link-hover'
      )}</h2>
      <div class="space-y-2">${renderManaged(ctx)}</div>
      <div class="divider text-xs opacity-60 my-1">Schedule</div>
      ${renderStaticStatus(ctx)}
      <div class="space-y-2">${gtfs}</div>
    </div>`;
}
