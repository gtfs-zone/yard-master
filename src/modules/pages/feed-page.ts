/**
 * The feed page: identity, children, then facts.
 *
 * yard-master's own page. test-track shows a feed status page here; this repo
 * is a manager, so the no-focus page is the feed itself.
 *
 * The order is the point. The feed names itself, then the two things that hang
 * off it — its trackers and its routes, each a scrollbox rather than a page —
 * and only then the facts about where its schedule comes from and what it
 * publishes. A reader arriving here wants an object, not a report.
 *
 * The facts are two sections and no more. `GTFS Scheduled` is everything about
 * the schedule: where it comes from, what the loader last made of it, and the
 * uploads it has kept. `GTFS Realtime Endpoints` is what this feed publishes.
 * The sibling apps open from whichever of the two they consume — the editor
 * edits the schedule, the visualizer reads the realtime endpoints — so neither
 * is a section of its own.
 *
 * What this browser parsed out of the zip is deliberately not reported here.
 * cafe-car's load and this browser's parse can legitimately disagree, and the
 * page used to print both sets of counts side by side and leave the reader to
 * notice; the map draws one of them and `renderScheduledStatus` says when the
 * other has not arrived, which is the same information without the table.
 */

import { CONFIG } from '../../config';
import type { Feed, GtfsUpload } from '../../types/api';
import type { RenderContext } from '../render-utils';
import { escHtml, prop, propList, routeBadge, section } from '../render-utils';
import { cappedNote, entityRow, entityRowList, rowSection } from '../entity-row';
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
import { routeSortKey } from '../route-sort';
import { assignmentCounts } from '../service-catalog';

/** Where a section heading's `(?)` sends a reader who wants the whole thing. */
const SCHEDULE_REFERENCE_URL = 'https://gtfs.org/documentation/schedule/reference/';
const REALTIME_REFERENCE_URL = 'https://gtfs.org/documentation/realtime/reference/';

/** The reference's own words, so this app is not paraphrasing the spec. */
const SCHEDULE_TOOLTIP = `The General Transit Feed Specification (GTFS) is a standardized format
  for public transportation schedules and associated geographic information.`;
const REALTIME_TOOLTIP = `GTFS Realtime is a feed specification that allows public transportation
  agencies to provide realtime updates about their fleet to application developers.`;

/**
 * A section heading's `(?)`, using the same trigger markup `spec-field.ts`
 * emits so `utils/tooltip-position.ts`'s portal picks it up with no new code.
 * The glyph is the link, matching `specLabelContent`, where the label is.
 */
function docsTooltip(url: string, content: string): string {
  return `<span class="field-tooltip-trigger cursor-help ml-1 align-middle text-xs opacity-60"
    tabindex="0" data-tooltip-content="${escHtml(content)}"
    ><a class="link link-hover" href="${escHtml(url)}" target="_blank"
      rel="noopener noreferrer">(?)</a></span>`;
}

/**
 * An external link, shown as the URL itself so it can be read and copied.
 *
 * `resolve` is for the realtime rows alone: those are stored as bare paths so a
 * link works in whichever environment opens it, and only they resolve against
 * the RT base. A schedule URL is already absolute — whatever its author typed,
 * or the one this app publishes — and is shown as it stands.
 */
function urlRow(label: string, url: string, resolve = false): string {
  const href = resolve ? resolveRealtimeUrl(url, CONFIG.RT_BASE) : url;
  return prop(
    label,
    `<a href="${escHtml(href)}" target="_blank" rel="noopener" class="link break-all font-mono text-xs">${escHtml(
      url
    )}</a>`
  );
}

// ─── The children ────────────────────────────────────────────────────────────

/**
 * Where the zip is up to. The managed half of the page works without it, so
 * "still downloading" and "did not load" are states this page renders in, not
 * reasons to render nothing.
 */
function renderScheduledStatus(ctx: RenderContext): string {
  const session = ctx.session;
  if (session.scheduleError) {
    return `<div class="alert alert-warning alert-sm text-xs">
      <span>The scheduled feed did not load: ${escHtml(session.scheduleError)}</span>
    </div>`;
  }
  if (!session.scheduledFeed) {
    return `<p class="text-xs opacity-60">Downloading the schedule…</p>`;
  }
  return '';
}

/** The scroll container every list on this page shares. */
function scrollbox(body: string): string {
  return `<div class="max-h-96 overflow-y-auto overflow-x-hidden px-2">${body}</div>`;
}

/**
 * Every tracker on the feed, reporting or not.
 *
 * A tracker with no fix has no coordinates and so is not on the map at all,
 * which makes this list the only place it exists. The liveness badge on each
 * row is what the page's old fleet summary counted; a reader asking "how many
 * are quiet" reads the badges rather than a number that agrees with them.
 */
function renderTrackers(ctx: RenderContext): string {
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

  return rowSection(
    'Trackers',
    trackers.length,
    `${scrollbox(entityRowList(rows, 'No trackers yet.'))}
     <div class="pt-1">${actionButton('tracker:new', '', 'New tracker')}</div>`
  );
}

/**
 * The feed's routes, in the order the map paints them.
 *
 * Same sort key as the layers, so the panel's order and the map's stacking
 * agree about which routes are the important ones, and descending so the one
 * that paints on top reads first.
 */
function renderRoutes(ctx: RenderContext): string {
  const feed = ctx.session.scheduledFeed;
  if (!feed) return rowSection('Routes', 0, renderScheduledStatus(ctx));

  const routes = [...feed.routes.values()].sort((a, b) => {
    const keyA = routeSortKey(a.raw.route_type, (feed.tripsByRoute.get(a.id) ?? []).length);
    const keyB = routeSortKey(b.raw.route_type, (feed.tripsByRoute.get(b.id) ?? []).length);
    if (keyA !== keyB) return keyB - keyA;
    return (a.short_name || a.long_name || a.id).localeCompare(b.short_name || b.long_name || b.id);
  });

  const shown = routes.slice(0, CONFIG.ROUTE_LIST_MAX);
  const rows = shown.map((route) => {
    const tripIds = (feed.tripsByRoute.get(route.id) ?? []).map((t) => t.trip_id);
    const counts = assignmentCounts(ctx.session, tripIds);
    return entityRow(ctx, {
      state: { type: 'route', route_id: route.id },
      // The badge already carries the route's colour, so the row's dot would
      // say the same thing twice.
      leadHtml: routeBadge(ctx, route),
      label: route.long_name || route.short_name || route.id,
      badge: counts ? `${counts.assigned}/${counts.total} assigned` : `${tripIds.length} trip${tripIds.length === 1 ? '' : 's'}`,
    });
  });

  return rowSection(
    'Routes',
    routes.length,
    `${scrollbox(entityRowList(rows, 'No routes in this feed.'))}
     ${cappedNote(routes.length, shown.length)}`
  );
}

// ─── GTFS Scheduled ──────────────────────────────────────────────────────────

/** Who uploaded it, if the members list happens to name them. */
function uploaderLabel(ctx: RenderContext, upload: GtfsUpload): string {
  const id = upload.uploaded_by_user_id;
  if (id === null) return 'someone no longer on this feed';
  const member = ctx.session.members?.members.find((m) => m.user_id === id);
  return member ? personLabel(member) : `user ${id}`;
}

/** One upload as a line: what it was, how big, when, and by whom. */
function uploadLine(ctx: RenderContext, upload: GtfsUpload): string {
  return `${escHtml(upload.original_filename)} - ${escHtml(
    formatBytes(upload.size_bytes)
  )} - ${isoWithAge(upload.uploaded_at)} - ${escHtml(uploaderLabel(ctx, upload))}`;
}

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

/**
 * The uploads this feed has kept, newest first, with the way back to any of
 * them.
 *
 * A disclosure, and inside the schedule section: an upload is a fact about
 * where the schedule came from, and the only one that is history rather than
 * current state. Rendered for a feed that has any, not only for a hosted one:
 * a feed switched back to a URL still has its history, and that history is the
 * only way to undo the switch.
 *
 * `ctx.session.uploads` carries three states: `undefined` while the request is
 * still out, `null` if it failed, and the array once it has loaded. A failure
 * gets a retry button rather than a spinner that never resolves.
 */
function renderHistory(ctx: RenderContext, feed: Feed): string {
  const uploads = ctx.session.uploads;
  if (uploads === undefined) {
    return isHosted(feed) ? '<p class="text-xs opacity-60">Loading upload history…</p>' : '';
  }
  if (uploads === null) {
    return `
      <p class="text-xs opacity-60">
        Could not load upload history.
        ${actionButton('feed:retry-uploads', '', 'Retry', 'btn-ghost btn-xs')}
      </p>`;
  }
  if (uploads.length === 0) return '';

  const shown = uploads.slice(0, CONFIG.UPLOAD_HISTORY_MAX);
  const rows = shown.map((upload) =>
    entityRow(ctx, {
      label: upload.original_filename,
      sublabel: `${formatBytes(upload.size_bytes)} - ${uploaderLabel(ctx, upload)}`,
      badgeHtml: upload.is_current
        ? '<span class="badge badge-xs badge-success">serving</span>'
        : `<span class="text-xs opacity-60">${isoWithAge(upload.uploaded_at)}</span>`,
      actionsHtml: upload.is_current
        ? ''
        : `${actionButton('upload:activate', upload.id, 'Serve')}
           ${actionButton('upload:delete', upload.id, 'Delete', 'btn-ghost btn-error')}`,
    })
  );

  return `
    <details class="text-xs rounded-lg border border-base-300 p-2" data-detail="feed:uploads">
      <summary class="cursor-pointer font-medium">Upload history (${uploads.length})</summary>
      <div class="mt-1">
        ${entityRowList(rows, 'No uploads yet.')}
        ${
          uploads.length > shown.length
            ? `<p class="text-xs opacity-50">${uploads.length - shown.length} older not shown.</p>`
            : ''
        }
      </div>
    </details>`;
}

/**
 * The schedule, whole: where it comes from, where a consumer gets it, and what
 * cafe-car's loader last made of it.
 *
 * The two kinds of source answer the same question differently — a linked feed
 * shows the URL it is downloaded from, a hosted feed shows the URL this app
 * publishes — and the load rows below them are the same either way. Every load
 * field is shown, including the ones that are null most of the time:
 * `next_retry_at` with a value is the difference between a load that failed and
 * gave up and one that failed and is coming back.
 */
function renderScheduled(ctx: RenderContext, feed: Feed): string {
  const hosted = isHosted(feed);
  const published = publicScheduleUrl(feed);
  const current = feed.current_upload;
  const load = feed.load;
  const scheduledFeed = ctx.session.scheduledFeed;

  const rows = [prop('Source', escHtml(sourceLabel(feed)))];
  if (scheduledFeed) {
    const counts = assignmentCounts(ctx.session, scheduledFeed.trips.keys());
    rows.push(prop('Trips assigned', counts ? `${counts.assigned} of ${counts.total}` : '—'));
  }
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

  if (load) {
    rows.push(prop('Last loaded', isoWithAge(load.last_loaded_at)));
    // `isoWithAge` counts in both directions, so a start in the past reads as
    // an elapsed time while a retry in the future reads as a countdown. Both
    // are driven by the panel's own ticker, so a running load shows itself
    // running without the stream having to say anything.
    rows.push(prop('Started', isoWithAge(load.started_at)));
    if (load.next_retry_at) rows.push(prop('Next retry', isoWithAge(load.next_retry_at)));
    rows.push(prop('Feed timezone', escHtml(load.timezone ?? '—')));
  }

  const editor = new URLSearchParams({ load: published ?? '' });

  return section(
    'GTFS Scheduled',
    `<div class="space-y-2">
      ${
        load?.error_message
          ? `<div class="alert alert-error alert-sm text-xs"><span>${escHtml(
              load.error_message
            )}</span></div>`
          : ''
      }
      ${
        published
          ? ''
          : `<p class="text-xs opacity-60">This feed has no schedule yet. Upload a zip or load one
             from a URL below to give it one.</p>`
      }
      ${propList(rows)}
      <div class="flex flex-wrap gap-2 pt-1">
        ${actionButton('feed:replace-schedule', '', 'Upload GTFS schedule')}
        ${actionButton('feed:link-schedule', '', 'Load schedule from URL')}
        ${hosted ? '' : reloadButton(feed)}
        ${published ? actionButton('feed:copy-schedule-url', '', 'Copy URL') : ''}
        <a class="btn btn-xs btn-outline" target="_blank" rel="noopener"
           href="${escHtml(`${CONFIG.EDITOR_BASE}/#${editor.toString()}`)}">Open in editor</a>
      </div>
      ${renderHistory(ctx, feed)}
    </div>`,
    docsTooltip(SCHEDULE_REFERENCE_URL, SCHEDULE_TOOLTIP)
  );
}

// ─── GTFS Realtime Endpoints ─────────────────────────────────────────────────

/**
 * What this feed publishes, and the app that reads it.
 *
 * The visualizer link is built from the feed's own URLs rather than from
 * anything this app holds, so it keeps working for whoever it is sent to: viz
 * runs on somebody else's machine and has no way to reach an object here.
 */
function renderRealtime(feed: Feed): string {
  // `static=` rather than `scheduled=`: viz renamed the param in `f54ae79` and
  // reads the old name as a fallback, so the old spelling reaches both the
  // deployed viz and a newer one.
  const viz = new URLSearchParams({
    static: publicScheduleUrl(feed) ?? '',
    rt_vp: resolveRealtimeUrl(feed.vehicle_positions_url, CONFIG.RT_BASE),
    rt_tu: resolveRealtimeUrl(feed.trip_updates_url, CONFIG.RT_BASE),
    rt_al: resolveRealtimeUrl(feed.service_alerts_url, CONFIG.RT_BASE),
  });

  return section(
    'GTFS Realtime Endpoints',
    `${propList([
      urlRow('Vehicle positions', feed.vehicle_positions_url, true),
      urlRow('Trip updates', feed.trip_updates_url, true),
      urlRow('Service alerts', feed.service_alerts_url, true),
    ])}
    <div class="flex flex-wrap gap-2 pt-1">
      <a class="btn btn-xs btn-outline" target="_blank" rel="noopener"
         href="${escHtml(`${CONFIG.VIZ_BASE}/#${viz.toString()}`)}">Open in visualizer</a>
    </div>`,
    docsTooltip(REALTIME_REFERENCE_URL, REALTIME_TOOLTIP)
  );
}

// ─── The feed row itself ─────────────────────────────────────────────────────

/**
 * What this reader may do to the feed. Last, because it acts on the whole page
 * rather than on any one section of it.
 *
 * `can_manage` is the permission rather than the fact, so an admin working on
 * somebody else's feed gets the owner-only buttons and the owner's own
 * `is_owner` is not what decides it.
 */
function renderActions(feed: Feed): string {
  return section(
    'Feed',
    `<div class="flex flex-wrap gap-2">
      ${actionButton('feed:edit', '', 'Edit')}
      ${feed.can_manage ? actionButton('feed:delete', '', 'Delete', 'btn-outline btn-error') : ''}
    </div>`
  );
}

export function renderFeedPage(ctx: RenderContext): string {
  const feed = ctx.session.feed;
  if (!feed) {
    return '<p class="text-base-content/50 text-sm text-center py-8">No feed selected</p>';
  }

  const owner = feed.is_owner
    ? 'you'
    : `${feed.owner_name ?? `user ${feed.owner_id}`}${feed.can_manage ? ' (you may manage it)' : ''}`;

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold leading-tight">${escHtml(feed.feed_name)}</h2>
        <div class="flex items-center gap-2 text-xs opacity-70">
          ${loadStatusBadge(feed.load, 'badge-xs')}
          <span>Owned by ${escHtml(owner)}</span>
        </div>
      </div>

      ${renderTrackers(ctx)}
      ${renderRoutes(ctx)}
      ${renderScheduled(ctx, feed)}
      ${renderRealtime(feed)}
      ${renderActions(feed)}
    </div>`;
}
