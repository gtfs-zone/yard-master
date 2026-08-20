/**
 * The feed page: the properties of the selected feed, where its last static
 * load got to, what is in it, and the way out to the sibling apps.
 *
 * yard-master's own page — test-track's nearest equivalent is its feed status
 * page, which reports on a feed somebody pasted rather than on a row this app
 * owns.
 *
 * The two halves of a feed are reported separately on purpose. `load` is what
 * *cafe-car* last made of the zip, which is what the published GTFS-RT feed is
 * built from; the counts underneath are what *this browser* parsed a moment
 * ago. They can legitimately disagree — a load that failed leaves the server on
 * an older schedule than the one the map is drawing — and a page that merged
 * them would hide exactly that.
 *
 * The three actions are not equally available. Editing is open to any member,
 * matching the API; transferring and deleting are what `can_manage` gates, and
 * a member who cannot do them is not shown a button that would 403.
 */

import { CONFIG } from '../../config';
import type { Feed } from '../../types/api';
import type { MapDataIssues } from '../layer-manager';
import type { RenderContext } from '../render-utils';
import { escHtml, prop, propList, section } from '../render-utils';
import { actionButton, isoWithAge, loadStatusBadge, trackerLiveness } from '../managed-render';
import { resolveRealtimeUrl } from '../feed-url-resolve';
import { renderIssueCard } from '../../utils/issue-card';

/**
 * An external link, shown as the URL itself so it can be read and copied.
 *
 * `resolve` is for the realtime rows alone: those are stored as bare paths so a
 * link works in whichever environment opens it, and only they resolve against
 * `RT_BASE`. A static feed URL is whatever its author typed and is shown as
 * typed.
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
      <div>${loadStatusBadge(load)}</div>
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

/** What this browser parsed out of the zip, or why it has nothing to report. */
function renderContents(ctx: RenderContext): string {
  const session = ctx.session;
  if (session.staticError) {
    return section(
      'In this browser',
      `<div class="alert alert-warning alert-sm text-xs">
        <span>The schedule did not load here: ${escHtml(session.staticError)}</span>
      </div>`
    );
  }
  const feed = session.staticFeed;
  if (!feed) {
    return section('In this browser', `<p class="text-xs opacity-60">Downloading the schedule…</p>`);
  }

  return section(
    'In this browser',
    `${propList([
      prop('Agencies', String(feed.agencies.length)),
      prop('Routes', String(feed.routes.size)),
      prop('Stops', String(feed.stops.size)),
      prop('Trips', String(feed.trips.size)),
      prop('Shapes', String(feed.shapes.size)),
    ])}
    <p class="text-xs opacity-50">Parsed from <span class="font-mono">static_feed_url</span> by this
    browser, not by the server.</p>`
  );
}

/**
 * The whole fleet at once: how many trackers are reporting, how many have gone
 * quiet, and how many have said nothing.
 *
 * This is the feed-wide version of the badge on each tracker row, and the
 * reason it is on this page: "three of my eleven trackers are not reporting" is
 * a question about the feed, and answering it by scrolling a list is how it
 * goes unnoticed.
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

  return section(
    'Fleet',
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

/** The managed objects hanging off the feed, as counts with a way in. */
function renderManaged(ctx: RenderContext): string {
  const session = ctx.session;
  const people = session.people;
  return section(
    'Managed here',
    propList([
      prop('Trackers', String(session.trackers.size)),
      prop('Service alerts', String(session.serviceAlerts.size)),
      prop(
        'People',
        people ? String(people.members.length + people.invites.length) : '<span class="opacity-40">…</span>'
      ),
    ])
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
  const viz = new URLSearchParams({
    static: feed.static_feed_url,
    rt_vp: resolveRealtimeUrl(feed.vehicle_positions_url),
    rt_tu: resolveRealtimeUrl(feed.trip_updates_url),
    rt_al: resolveRealtimeUrl(feed.service_alerts_url),
  });
  const editor = new URLSearchParams({ load: feed.static_feed_url });

  return section(
    'Open in',
    `<div class="flex flex-wrap gap-2">
      <a class="btn btn-xs btn-outline" target="_blank" rel="noopener"
         href="${escHtml(`${CONFIG.VIZ_BASE}/#${viz.toString()}`)}">Visualizer</a>
      <a class="btn btn-xs btn-outline" target="_blank" rel="noopener"
         href="${escHtml(`${CONFIG.EDITOR_BASE}/#${editor.toString()}`)}">Editor</a>
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
    ${feed.can_manage ? actionButton('feed:transfer', '', 'Transfer') : ''}
    ${feed.can_manage ? actionButton('feed:delete', '', 'Delete', 'btn-outline btn-error') : ''}
  </div>`;
}

export function renderFeedPage(ctx: RenderContext, issues: MapDataIssues): string {
  const feed = ctx.session.feed;
  if (!feed) return '<p class="text-sm opacity-60">No feed is selected.</p>';

  const owner = feed.is_owner
    ? 'you'
    : `${feed.owner_name ?? `user ${feed.owner_id}`}${feed.can_manage ? ' (you may manage it)' : ''}`;

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold leading-tight">${escHtml(feed.feed_name)}</h2>
        <div class="flex items-center gap-2">${loadStatusBadge(feed.load, 'badge-xs')}</div>
      </div>

      ${renderActions(feed)}

      ${renderLoad(feed)}

      ${section(
        'Properties',
        propList([prop('Owner', escHtml(owner)), urlRow('Static feed', feed.static_feed_url)])
      )}

      ${section(
        'Published realtime',
        propList([
          urlRow('Vehicle positions', feed.vehicle_positions_url, true),
          urlRow('Trip updates', feed.trip_updates_url, true),
          urlRow('Service alerts', feed.service_alerts_url, true),
        ])
      )}

      ${renderManaged(ctx)}
      ${renderFleet(ctx)}
      ${renderContents(ctx)}
      ${renderIssues(ctx, issues)}
      ${renderOpenIn(feed)}
    </div>`;
}
