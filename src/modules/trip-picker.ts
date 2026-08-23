/**
 * Naming a trip, and offering the ones worth naming.
 *
 * A feed holds tens of thousands of trips, so this was a fuzzy-search modal of
 * its own for a while: assigning a tracker meant one dialog to choose the trip
 * and a second to describe the assignment. Two dialogs to make one object.
 *
 * What replaced it is scope. A form opened from a route or a trip is about that
 * route, and a form opened from nowhere in particular is nearly always about a
 * route this feed already assigns somebody to. Either list is short enough for
 * a `<select>`, and the combo `entity-form` already renders is the fallback
 * when it is not — free text and all, because an unreachable `static_feed_url`
 * is a normal state here and the server does not check a trip id against the
 * schedule either.
 */

import type { GTFSStatic, Trip } from '../gtfs-static';
import type { FieldOption } from './entity-form';
import type { FeedSession } from './feed-session';
import { formatScheduleTime } from './feed-time';

/** What a trip is called here: its short name, then its headsign, then its id. */
export function tripName(trip: Trip): string {
  return trip.raw.trip_short_name?.trim() || trip.headsign || trip.trip_id;
}

/** The trip's first departure as a clock reading, or null if it has no times. */
function firstDeparture(feed: GTFSStatic, trip: Trip): string | null {
  const first = feed.stopTimesByTrip.get(trip.trip_id)?.[0];
  return first?.departure_time || first?.arrival_time || null;
}

function routeLabel(feed: GTFSStatic, trip: Trip): string {
  const route = feed.routes.get(trip.route_id);
  return route ? route.short_name || route.long_name || route.id : trip.route_id;
}

/**
 * One line naming a trip: when it leaves, what it runs and where it goes.
 *
 * The departure comes first because it is what tells two runs of the same
 * route apart, which is the whole question being asked of this list.
 */
export function tripLabel(feed: GTFSStatic, trip: Trip): string {
  const departure = firstDeparture(feed, trip);
  return [departure ? formatScheduleTime(departure) : null, routeLabel(feed, trip), tripName(trip)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Trips as form options, in departure order.
 *
 * `detail` is the id, so the combo's own filter matches a typed id as well as
 * a typed name and nothing has to search twice.
 */
export function tripOptions(feed: GTFSStatic | null, trips?: Iterable<Trip>): FieldOption[] {
  if (!feed) return [];
  const list = [...(trips ?? feed.trips.values())];
  list.sort((a, b) => {
    const at = firstDeparture(feed, a) ?? '';
    const bt = firstDeparture(feed, b) ?? '';
    return at === bt ? tripName(a).localeCompare(tripName(b)) : at.localeCompare(bt);
  });
  return list.map((trip) => ({
    value: trip.trip_id,
    label: tripLabel(feed, trip),
    detail: trip.trip_id,
  }));
}

/**
 * The trips an assignment form offers.
 *
 * With a route in hand that is the route's own trips. Without one it is what
 * the feed already assigns: every trip a rule names, plus the rest of the
 * trips on those routes, because the next assignment is nearly always another
 * run of something already being tracked.
 */
export function assignableTrips(session: FeedSession, routeId: string | null): Trip[] {
  const feed = session.staticFeed;
  if (!feed) return [];
  if (routeId) return [...feed.trips.values()].filter((trip) => trip.route_id === routeId);

  const named = new Set<string>();
  const routes = new Set<string>();
  for (const rule of session.rules?.values() ?? []) {
    named.add(rule.trip_id);
    const trip = feed.trips.get(rule.trip_id);
    if (trip) routes.add(trip.route_id);
  }
  return [...feed.trips.values()].filter(
    (trip) => routes.has(trip.route_id) || named.has(trip.trip_id)
  );
}
