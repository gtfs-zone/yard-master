/**
 * The browse tree: the panel's home page, and the way into every object that
 * has no map feature to click.
 *
 * yard-master's own page. test-track shows a feed status page here; this repo
 * is a manager, so the no-focus page is a hierarchy instead. The managed half
 * (trackers, assignments, alerts, people) sits above the divider and is filled
 * in phase 5b; the GTFS half below it comes from the in-browser zip and is what
 * this phase renders.
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
      ${renderStaticStatus(ctx)}
      <div class="space-y-2">${gtfs}</div>
    </div>`;
}
