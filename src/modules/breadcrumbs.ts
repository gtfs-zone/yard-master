/* @vendored-from test-track:src/modules/breadcrumbs.ts
   @sha f40d80a
   @status modified
   @changes
   - The variant set is yard-master's. `vehicle` became `tracker` and resolves
     against `session.trackers` (the API list) rather than only against the
     live map, so a tracker that has never reported a fix still has a label.
   - `trip` added, with its route as the parent when the feed names one.
   - Every crumb is a real ancestor and never a category: there are no list
     pages, so a tracker and a route both hang straight off the feed, a trip
     hangs off its route, a stop off its `parent_station` chain and an alert off
     the entity it informs. Three crumbs is the deepest trail in the app.
   - HOME is the feed root rather than test-track's "Feed status" page, and it
     is labelled with the selected feed's name.
   - `alertLabel` reads the managed `serviceAlerts` map first, since an
     `alert` PageState names a row in the API rather than a decoded entity, and
     falls back to the live payload for one that is only there.
   - `validateState` answers true for the managed variants while the API list
     is still loading: an empty `trackers` map means "not fetched yet" as often
     as it means "no such tracker", and falling back to home on a slow request
     would drop a perfectly good link. */
/**
 * Synchronous breadcrumb building and focus validation against the session.
 *
 * Our whole model is in memory — parsed GTFS plus the API objects the session
 * holds — so both of these are plain reads rather than the async, database
 * backed lookups coloring-book needs.
 */

import type { PageState } from '../types/page-state';
import type { BreadcrumbItem } from 'interlocking/modules/breadcrumb-trail';
import { stopTypeLabel } from 'interlocking/modules/breadcrumb-trail';
import type { FeedSession } from './feed-session';

/**
 * Cap a breadcrumb label's length. Some GTFS-RT producers put full sentences
 * in an alert's `header_text` rather than a short title, which wraps a crumb
 * across several lines and reads as body copy instead of a breadcrumb.
 */
function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function home(session: FeedSession): BreadcrumbItem<PageState> {
  return {
    typeLabel: 'Feed',
    label: truncate(session.feed?.feed_name ?? 'Feed'),
    pageState: { type: 'home' },
  };
}

/** Human label for a route: short name, long name, or the bare id. */
export function routeLabel(session: FeedSession, routeId: string): string {
  const route = session.scheduledFeed?.routes.get(routeId);
  if (!route) return routeId;
  return route.short_name || route.long_name || route.id;
}

export function stopLabel(session: FeedSession, stopId: string): string {
  return session.scheduledFeed?.stops.get(stopId)?.name || stopId;
}

/** The crumb eyebrow for a stop: its `location_type`, or a plain stop. */
function stopEyebrow(session: FeedSession, stopId: string): string {
  return stopTypeLabel(session.scheduledFeed?.stops.get(stopId)?.location_type);
}

export function tripLabel(session: FeedSession, tripId: string): string {
  const trip = session.scheduledFeed?.trips.get(tripId);
  return trip?.headsign || tripId;
}

/** Nickname is the label a tracker shows; the surrogate is the fallback. */
export function trackerLabel(session: FeedSession, trackerId: string): string {
  return session.trackers.get(trackerId)?.nickname || trackerId;
}

export function alertLabel(session: FeedSession, alertId: string): string {
  const managed = session.serviceAlerts.get(alertId);
  if (managed) return managed.header_text || `Alert ${alertId}`;
  const alert = session.alerts.get(alertId)?.alert;
  const header = alert?.headerText?.translation?.[0]?.text;
  return header ? String(header) : `Alert ${alertId}`;
}

/**
 * The chain of parents leading to a stop, outermost first.
 *
 * `parent_station` is a single edge in practice, but the loop guards against a
 * feed with a cycle rather than hanging on one.
 */
function stopAncestors(session: FeedSession, stopId: string): string[] {
  const feed = session.scheduledFeed;
  if (!feed) return [];

  const chain: string[] = [];
  const seen = new Set<string>([stopId]);
  let parent = feed.stops.get(stopId)?.parent_station;
  while (parent && !seen.has(parent) && feed.stops.has(parent)) {
    chain.unshift(parent);
    seen.add(parent);
    parent = feed.stops.get(parent)?.parent_station;
  }
  return chain;
}

/** The route a trip belongs to, from the state or from the parsed feed. */
function tripRouteId(session: FeedSession, state: PageState): string | null {
  if (state.type !== 'trip') return null;
  return state.route_id ?? session.scheduledFeed?.trips.get(state.trip_id)?.route_id ?? null;
}

type AlertParent =
  | { type: 'route'; route_id: string }
  | { type: 'stop'; stop_id: string };

/** The first entity an alert names that we have a page for. */
function alertParent(session: FeedSession, alertId: string): AlertParent | null {
  // The managed detail is the authority when it has been fetched; the entity
  // list only exists on the detail, so a summary alone names no parent.
  for (const entity of session.alertDetails.get(alertId)?.entities ?? []) {
    if (entity.route_id) return { type: 'route', route_id: entity.route_id };
    if (entity.stop_id) return { type: 'stop', stop_id: entity.stop_id };
  }

  const informed = session.alerts.get(alertId)?.alert.informedEntity;
  if (!informed) return null;

  for (const entity of informed) {
    if (entity.routeId) return { type: 'route', route_id: entity.routeId };
    if (entity.stopId) return { type: 'stop', stop_id: entity.stopId };
  }
  return null;
}

function routeCrumb(session: FeedSession, routeId: string): BreadcrumbItem<PageState> {
  return {
    typeLabel: 'Route',
    label: truncate(routeLabel(session, routeId)),
    pageState: { type: 'route', route_id: routeId },
  };
}

export function buildBreadcrumbs(session: FeedSession, state: PageState): BreadcrumbItem<PageState>[] {
  switch (state.type) {
    case 'home':
      return [];

    case 'tracker':
      return [
        home(session),
        {
          typeLabel: 'Tracker',
          label: truncate(trackerLabel(session, state.tracker_id)),
          pageState: state,
        },
      ];

    case 'route':
      return [home(session), routeCrumb(session, state.route_id)];

    case 'stop':
      return [
        home(session),
        ...stopAncestors(session, state.stop_id).map((id) => ({
          typeLabel: stopEyebrow(session, id),
          label: truncate(stopLabel(session, id)),
          pageState: { type: 'stop' as const, stop_id: id },
        })),
        {
          typeLabel: stopEyebrow(session, state.stop_id),
          label: truncate(stopLabel(session, state.stop_id)),
          pageState: state,
        },
      ];

    case 'trip': {
      const routeId = tripRouteId(session, state);
      return [
        home(session),
        ...(routeId ? [routeCrumb(session, routeId)] : []),
        {
          typeLabel: 'Trip',
          label: truncate(tripLabel(session, state.trip_id)),
          pageState: state,
        },
      ];
    }

    case 'alert': {
      const parent = alertParent(session, state.alert_id);
      return [
        home(session),
        ...(parent
          ? [
              {
                typeLabel:
                  parent.type === 'route' ? 'Route' : stopEyebrow(session, parent.stop_id),
                label: truncate(
                  parent.type === 'route'
                    ? routeLabel(session, parent.route_id)
                    : stopLabel(session, parent.stop_id),
                ),
                pageState: parent,
              },
            ]
          : []),
        {
          typeLabel: 'Service alert',
          label: truncate(alertLabel(session, state.alert_id)),
          pageState: state,
        },
      ];
    }
  }
}

/**
 * Whether a focus still names something the session can render.
 *
 * The GTFS variants are checked against the parsed feed, so they answer false
 * until the zip has finished — which is why the caller re-checks on
 * `scheduleloaded` rather than dropping a pending focus on the first miss.
 *
 * A tracker or alert is checked against the API list once it has arrived, and
 * accepted while it is empty: an empty map is "not fetched yet" as often as it
 * is "no such object", and a good link should not be discarded by a slow
 * request.
 */
export function validateState(session: FeedSession, state: PageState): boolean {
  switch (state.type) {
    case 'home':
      return true;
    case 'route':
      return session.scheduledFeed?.routes.has(state.route_id) ?? false;
    case 'stop':
      return session.scheduledFeed?.stops.has(state.stop_id) ?? false;
    case 'trip':
      return session.scheduledFeed?.trips.has(state.trip_id) ?? false;
    case 'tracker':
      return session.trackers.size === 0 || session.trackers.has(state.tracker_id);
    case 'alert':
      if (session.serviceAlerts.has(state.alert_id)) return true;
      return session.serviceAlerts.size === 0 && session.alerts.size === 0;
  }
}
