/**
 * The feed page: everything about the selected feed, and the way into every
 * object hanging off it.
 *
 * yard-master's own page. test-track shows a feed status page here; this repo
 * is a manager, so the no-focus page is the feed itself plus a hierarchy. The
 * header block is the feed row the API owns — its identity, where its schedule
 * comes from, what the loader last made of it, and what this reader may do to
 * it. The managed half (trackers, assignments, alerts, managers) comes from the
 * API, and the GTFS half below the divider comes from the in-browser zip. The
 * two are independent: the managed half renders the moment a feed is selected,
 * while the zip is still downloading, or never arrives at all.
 *
 * The two halves of a feed are reported separately on purpose. `load` is what
 * *cafe-car* last made of the zip, which is what the published GTFS-RT feed is
 * built from; the counts under "In this browser" are what *this browser*
 * parsed a moment ago. They can legitimately disagree — a load that failed
 * leaves the server on an older schedule than the one the map is drawing — and
 * a page that merged them would hide exactly that.
 *
 * The actions are not equally available. Editing the feed and replacing its
 * schedule are open to any member, matching the API; deleting is what
 * `can_manage` gates, and a member who cannot do it is not shown a button that
 * would 403. Transferring is `can_manage`-gated too, and lives on the managers
 * page next to the list of people it can hand the feed to.
 *
 * Section bodies are `<details>` so the panel renderer's open-detail tracking
 * survives a re-render. Long sections are capped: a large feed has tens of
 * thousands of stops, and paging through them is what the search box is for.
 */

import { CONFIG } from '../../config';
import type { Stop } from '../../gtfs-static';
import type { Feed, GtfsUpload } from '../../types/api';
import type { PageState } from '../../types/page-state';
import type { MapDataIssues } from '../layer-manager';
import type { RenderContext } from '../render-utils';
import { entityLink, escHtml, prop, propList, routeBadge, section } from '../render-utils';
import {
  cappedNote,
  countBadge,
  entityRow,
  entityRowList,
} from '../entity-row';
import {
  actionButton,
  isoWithAge,
  livenessBadge,
  loadStatusBadge,
  personLabel,
  trackerLiveness,
} from '../managed-render';
import { resolveRealtimeUrl } from '../feed-url-resolve';
import { isHosted, publicScheduleUrl, sourceLabel } from '../feed-source';
import { formatBytes } from '../feed-download';
import { renderIssueCard } from '../../utils/issue-card';
import { routeSortKey } from '../route-sort';

/** A collapsible section: a header with a count, and a list under it. */
function treeSection(key: string, title: string, count: number | string, body: string): string {
  return `
    <details class="rounded-lg border border-base-300" data-detail="tree:${escHtml(key)}">
      <summary class="cursor-pointer px-3 py-2 text-sm font-semibold flex items-center gap-2">
        <span>${escHtml(title)}</span>
        ${count === '' ? '' : countBadge(count)}
      </summary>
      <div class="px-3 pb-3">${body}</div>
    </details>`;
}

/**
 * An external link, shown as the URL itself so it can be read and copied.
 *
 * `resolve` is for the realtime rows alone: those are stored as bare paths so a
 * link works in whichever environment opens it, and only they resolve against
 * `RT_BASE`. A schedule URL is already absolute — whatever its author typed,
 * or the one this app publishes — and is shown as it stands.
 */
function urlRow(label: string, url: string, resolve = false): string {
  const href = resolve ? resolveRealtimeUrl(url) : url;
  return prop(
    label,
    `<a href="${escHtml(href)}" target="_blank" rel="noopener" class="link break-all font-mono text-xs">${escHtml(
      url
    )}</a>`
  );
}

// ─── The feed itself ─────────────────────────────────────────────────────────

/**
 * Where cafe-car's copy of the schedule stands. Every field the API reports is
 * shown, including the ones that are null most of the time: `next_retry_at`
 * with a value is the difference between a load that failed and gave up and one
 * that failed and is coming back.
 */
function renderLoad(feed: Feed): string {
  const load = feed.load;
  if (!load) {
    return section(
      'Static load',
      `<p class="text-xs opacity-60">This feed has never been handed to the loader. Its schedule
       is not on the server yet, so the published realtime feed has nothing to match against.</p>`
    );
  }

  return section(
    'Static load',
    `<div class="space-y-2">
      ${
        load.error_message
          ? `<div class="alert alert-error alert-sm text-xs"><span>${escHtml(
              load.error_message
            )}</span></div>`
          : ''
      }
      ${propList([
        prop('Last loaded', isoWithAge(load.last_loaded_at)),
        // `isoWithAge` counts in both directions, so a start in the past reads
        // as an elapsed time while a retry in the future reads as a countdown.
        // Both are driven by the panel's own ticker, so a running load shows
        // itself running without the stream having to say anything.
        prop('Started', isoWithAge(load.started_at)),
        load.next_retry_at ? prop('Next retry', isoWithAge(load.next_retry_at)) : '',
        prop('Feed timezone', escHtml(load.timezone ?? '—')),
      ])}
    </div>`
  );
}

/** Who uploaded it, if the members list happens to name them. */
function uploaderLabel(ctx: RenderContext, upload: GtfsUpload): string {
  const id = upload.uploaded_by_user_id;
  if (id === null) return 'someone no longer on this feed';
  const member = ctx.session.members?.members.find((m) => m.user_id === id);
  return member ? personLabel(member) : `user ${id}`;
}

/** One upload as a line: what it was, how big, when, and by whom. */
function uploadLine(ctx: RenderContext, upload: GtfsUpload): string {
  return `${escHtml(upload.original_filename)} · ${escHtml(
    formatBytes(upload.size_bytes)
  )} · ${isoWithAge(upload.uploaded_at)} · ${escHtml(uploaderLabel(ctx, upload))}`;
}

/**
 * Where this feed's schedule comes from, and where a consumer gets it.
 *
 * The two kinds answer the same two questions differently: a linked feed shows
 * the URL it is downloaded from, which is also the URL a consumer would use; a
 * hosted feed shows the URL this app publishes, which is the only one anybody
 * outside the stack is given for it.
 */
/**
 * Re-download a linked feed's zip.
 *
 * Disabled while cafe-car's own load is running, which the event stream
 * reports as it happens. Queueing a second load on top of one already in
 * flight does nothing — schedule-foamer's task is a singleton per feed — so a
 * button that offered it would be lying about what it does.
 */
function reloadButton(feed: Feed): string {
  const running = feed.load?.status === 'running';
  return actionButton('feed:reload', '', running ? 'Reloading…' : 'Reload', 'btn-outline', running);
}

function renderSource(ctx: RenderContext, feed: Feed): string {
  const hosted = isHosted(feed);
  const published = publicScheduleUrl(feed);
  const current = feed.current_upload;

  const rows = [prop('Source', escHtml(sourceLabel(feed)))];
  if (hosted) {
    rows.push(
      published
        ? urlRow('Published at', published)
        : prop('Published at', '<span class="opacity-40">nothing uploaded yet</span>')
    );
    rows.push(
      current
        ? prop('Serving', uploadLine(ctx, current))
        : prop('Serving', '<span class="opacity-40">nothing uploaded yet</span>')
    );
  } else {
    rows.push(urlRow('Downloaded from', feed.static_feed_url ?? '—'));
  }

  return section(
    'Schedule source',
    `${propList(rows)}
    <div class="flex flex-wrap gap-2 pt-2">
      ${actionButton(
        'feed:replace-schedule',
        '',
        hosted ? 'Replace schedule' : 'Upload a schedule'
      )}
      ${hosted ? '' : reloadButton(feed)}
      ${published ? actionButton('feed:copy-schedule-url', '', 'Copy URL') : ''}
    </div>`
  );
}

/**
 * The uploads this feed has kept, newest first, with the way back to any of
 * them.
 *
 * Rendered for a feed that has any, not only for a hosted one: a feed switched
 * back to a URL still has its history, and that history is the only way to
 * undo the switch.
 */
function renderHistory(ctx: RenderContext, feed: Feed): string {
  const uploads = ctx.session.uploads;
  if (uploads === null) {
    return isHosted(feed)
      ? treeSection('uploads', 'Upload history', '', '<p class="text-xs opacity-60">Loading…</p>')
      : '';
  }
  if (uploads.length === 0) return '';

  const shown = uploads.slice(0, CONFIG.UPLOAD_HISTORY_MAX);
  const rows = shown.map((upload) =>
    entityRow(ctx, {
      label: upload.original_filename,
      sublabel: `${formatBytes(upload.size_bytes)} · ${uploaderLabel(ctx, upload)}`,
      badgeHtml: upload.is_current
        ? '<span class="badge badge-xs badge-success">serving</span>'
        : `<span class="text-xs opacity-60">${isoWithAge(upload.uploaded_at)}</span>`,
      actionsHtml: upload.is_current
        ? ''
        : `${actionButton('upload:activate', upload.id, 'Serve')}
           ${actionButton('upload:delete', upload.id, 'Delete', 'btn-ghost btn-error')}`,
    })
  );

  return treeSection(
    'uploads',
    'Upload history',
    uploads.length,
    `${entityRowList(rows, 'No uploads yet.')}
     ${
       uploads.length > shown.length
         ? `<p class="text-xs opacity-50">${uploads.length - shown.length} older not shown.</p>`
         : ''
     }`
  );
}

/**
 * The sibling apps, opened on this feed.
 *
 * Both links are built from the feed's own URLs rather than from anything this
 * app holds, so they keep working for whoever the link is sent to: viz takes
 * the published realtime endpoints in its hash, and the editor takes the static
 * zip through its `load` command.
 */
function renderOpenIn(feed: Feed): string {
  // The published URL rather than the upstream one, so a hosted feed opens in
  // both apps at all: they run on somebody else's machine and have no way to
  // reach an object this app is holding.
  const schedule = publicScheduleUrl(feed) ?? '';
  const viz = new URLSearchParams({
    static: schedule,
    rt_vp: resolveRealtimeUrl(feed.vehicle_positions_url),
    rt_tu: resolveRealtimeUrl(feed.trip_updates_url),
    rt_al: resolveRealtimeUrl(feed.service_alerts_url),
  });
  const editor = new URLSearchParams({ load: schedule });

  return treeSection(
    'urls',
    'URLs',
    '',
    `${propList([
      urlRow('Vehicle positions', feed.vehicle_positions_url, true),
      urlRow('Trip updates', feed.trip_updates_url, true),
      urlRow('Service alerts', feed.service_alerts_url, true),
    ])}
    <div class="flex flex-wrap gap-2 pt-2">
      <a class="btn btn-xs btn-outline" target="_blank" rel="noopener"
         href="${escHtml(`${CONFIG.VIZ_BASE}/#${viz.toString()}`)}">Open in visualizer</a>
      <a class="btn btn-xs btn-outline" target="_blank" rel="noopener"
         href="${escHtml(`${CONFIG.EDITOR_BASE}/#${editor.toString()}`)}">Open in editor</a>
    </div>`
  );
}

/**
 * What this reader may do to the feed.
 *
 * `can_manage` is the permission rather than the fact, so an admin working on
 * somebody else's feed gets the owner-only buttons and the owner's own
 * `is_owner` is not what decides it.
 */
function renderActions(feed: Feed): string {
  return `<div class="flex flex-wrap gap-2">
    ${actionButton('feed:edit', '', 'Edit')}
    ${feed.can_manage ? actionButton('feed:delete', '', 'Delete', 'btn-outline btn-error') : ''}
  </div>`;
}

// ─── The GTFS half ───────────────────────────────────────────────────────────

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
  const rows = shown.map((route) => {
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

  return treeSection(
    'routes',
    'Routes',
    routes.length,
    `${entityRowList(rows, 'No routes in this feed.')}${cappedNote(routes.length, shown.length)}`
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
  const rows = shown.map((stop) => {
    const children = feed.descendants(stop.id).length;
    return entityRow(ctx, {
      state: { type: 'stop', stop_id: stop.id },
      label: stop.name || stop.id,
      sublabel: stop.name ? stop.id : undefined,
      ...(children ? { badge: `${children} platform${children === 1 ? '' : 's'}` } : {}),
    });
  });

  return treeSection(
    'stops',
    'Stops',
    places.length,
    `${entityRowList(rows, 'No stops in this feed.')}${cappedNote(places.length, shown.length)}`
  );
}

/** What this browser parsed out of the zip, beyond the lists above. */
function renderContents(ctx: RenderContext): string {
  const feed = ctx.session.staticFeed;
  if (!feed) return '';

  return treeSection(
    'contents',
    'In this browser',
    '',
    `${propList([
      prop('Agencies', String(feed.agencies.length)),
      prop('Routes', String(feed.routes.size)),
      prop('Stops', String(feed.stops.size)),
      prop('Trips', String(feed.trips.size)),
      prop('Shapes', String(feed.shapes.size)),
    ])}
    <p class="text-xs opacity-50">Parsed from the feed's schedule zip by this browser, not by the
    server.</p>`
  );
}

/**
 * What the map could not draw, as the vendored warning card.
 *
 * The unmatched row is reworded rather than reused as upstream words it. In
 * test-track an unmatched vehicle means somebody else's feed is lying to you:
 * it claims a route the schedule does not contain. Here it is usually the
 * ordinary state of an idle tracker, which is reporting a position and is not
 * assigned to anything, so the wording has to lead with that and mention the
 * feed problem second.
 */
function renderIssues(ctx: RenderContext, issues: MapDataIssues): string {
  // Only meaningful once the map has something to have drawn: before the zip
  // parses every vehicle is unmatched by definition.
  if (!ctx.session.staticFeed) return '';

  return renderIssueCard('Not drawn', [
    {
      label: 'Vehicles not on a known trip',
      count: issues.vehiclesUnmatched,
      note: `Reporting a position, but not running a trip this schedule describes. That is the
             normal state of an idle tracker; it also covers a tracker assigned to a trip the
             loaded feed no longer has. They draw in grey on the map.`,
    },
    {
      label: 'Stops with no stop_id',
      count: issues.stopsMissingId,
      note: 'Unaddressable, so they cannot be drawn, linked to or focused.',
    },
    {
      label: 'Stops with no coordinates',
      count: issues.stopsMissingCoords,
      note: 'A blank or unparseable stop_lat/stop_lon. They are in the feed but not on the map.',
    },
    {
      label: 'Vehicles sharing a map feature',
      count: issues.vehiclesDuplicateKeys,
      note: `Must be zero. A non-zero count means two vehicles collapsed onto one dot, which is
             a bug in how cafe-car derives a vehicle key, not a problem with this feed.`,
    },
  ]);
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
  // Every tracker is listed, reporting or not. A tracker with no fix has no
  // coordinates and so is not on the map at all, which makes this list the only
  // place it exists — and seeing which ones are idle is how you decide what to
  // assign.
  const rows = shown.map((tracker) =>
    entityRow(ctx, {
      state: { type: 'tracker', tracker_id: tracker.id },
      label: tracker.nickname,
      badgeHtml: livenessBadge(trackerLiveness(ctx.session, tracker.id)),
    })
  );

  // The create buttons live in the section rather than in the header block:
  // this is the list somebody is looking at when they notice one is missing.
  const create = `<div class="flex flex-wrap gap-2 mt-2">
    ${actionButton('tracker:new', '', 'New tracker')}
  </div>`;

  return treeSection(
    'trackers',
    'Trackers',
    trackers.length,
    `${entityRowList(rows, 'No trackers yet.')}${cappedNote(trackers.length, shown.length)}${create}`
  );
}

function renderAlerts(ctx: RenderContext): string {
  const alerts = [...ctx.session.serviceAlerts.values()].sort((a, b) => b.id - a.id);
  const shown = alerts.slice(0, CONFIG.TREE_LIST_MAX);
  const rows = shown.map((alert) =>
    entityRow(ctx, {
      state: { type: 'alert', alert_id: String(alert.id) },
      label: alert.header_text || `Alert ${alert.id}`,
      badge: `${alert.entity_count} entit${alert.entity_count === 1 ? 'y' : 'ies'}`,
    })
  );

  return treeSection(
    'alerts',
    'Service alerts',
    alerts.length,
    `${entityRowList(rows, 'No service alerts.')}${cappedNote(alerts.length, shown.length)}
     <div class="mt-2">${actionButton('alert:new', '', 'New alert')}</div>`
  );
}

/**
 * The whole fleet at once: how many trackers are reporting, how many have gone
 * quiet, and how many have said nothing.
 *
 * This is the feed-wide version of the badge on each tracker row, and the
 * reason it is here: "three of my eleven trackers are not reporting" is a
 * question about the feed, and answering it by scrolling a list is how it goes
 * unnoticed.
 */
function renderFleet(ctx: RenderContext): string {
  const session = ctx.session;
  if (session.trackers.size === 0) return '';

  let reporting = 0;
  let quiet = 0;
  let silent = 0;
  for (const tracker of session.trackers.values()) {
    const liveness = trackerLiveness(session, tracker.id);
    if (liveness.state === 'reporting') reporting += 1;
    else if (liveness.state === 'quiet') quiet += 1;
    else silent += 1;
  }

  return treeSection(
    'fleet',
    'Fleet',
    `${reporting} reporting`,
    `${propList([
      prop('Reporting', String(reporting)),
      // Only shown once it has happened: before then it is always zero, and a
      // permanent zero reads like a claim that nothing ever goes quiet.
      quiet ? prop('Went quiet', String(quiet)) : '',
      prop('No fix', String(silent)),
      // Not the same as the tracker count: one tracker can be carrying several.
      reporting && session.vehicles.size !== reporting
        ? prop('Vehicles', String(session.vehicles.size))
        : '',
    ])}
    <p class="text-xs opacity-50">A position expires ${Math.round(
      CONFIG.TRACKER_STALE_MS / 1000
    )} seconds after it is posted, so "reporting" means a fix arrived within the last
    minute. Nothing here is remembered across a reload.</p>`
  );
}

function renderManaged(ctx: RenderContext): string {
  const members = ctx.session.members;
  const managerNote = members
    ? `${members.members.length} manager${members.members.length === 1 ? '' : 's'}${
        members.invites.length ? `, ${members.invites.length} invited` : ''
      }`
    : '';
  return `
    ${renderTrackers(ctx)}
    ${treeLink(ctx, { type: 'assignments' }, 'Assignments', '')}
    ${renderAlerts(ctx)}
    ${treeLink(ctx, { type: 'managers' }, 'Managers', managerNote)}
    ${renderFleet(ctx)}`;
}

/**
 * Where the zip is up to. The managed half of the page works without it, so
 * "still downloading" and "did not load" are states this page renders in, not
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

export function renderTreePage(ctx: RenderContext, issues: MapDataIssues): string {
  const session = ctx.session;
  const feed = session.feed;
  if (!feed) {
    return '<p class="text-base-content/50 text-sm text-center py-8">No feed selected</p>';
  }

  const owner = feed.is_owner
    ? 'you'
    : `${feed.owner_name ?? `user ${feed.owner_id}`}${feed.can_manage ? ' (you may manage it)' : ''}`;

  const gtfs = session.staticFeed ? `${renderRoutes(ctx)}${renderStops(ctx)}` : '';

  return `
    <div class="space-y-3">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold leading-tight">${escHtml(feed.feed_name)}</h2>
        <div class="flex items-center gap-2 text-xs opacity-70">
          ${loadStatusBadge(feed.load, 'badge-xs')}
          <span>Owned by ${escHtml(owner)}</span>
        </div>
      </div>

      ${renderActions(feed)}
      ${renderLoad(feed)}
      ${renderSource(ctx, feed)}

      <div class="space-y-2">
        ${renderHistory(ctx, feed)}
        ${renderOpenIn(feed)}
      </div>

      <div class="space-y-2">${renderManaged(ctx)}</div>

      <div class="divider text-xs opacity-60 my-1">Schedule</div>
      ${renderStaticStatus(ctx)}
      <div class="space-y-2">
        ${gtfs}
        ${renderContents(ctx)}
      </div>
      ${renderIssues(ctx, issues)}
    </div>`;
}
