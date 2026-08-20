/* @vendored-from test-track:src/modules/search-entries.ts
   @sha 56f120a
   @status modified
   @changes
   - The vehicle loop became a tracker loop: the payload is a `tracker`
     PageState keyed by `Tracker.id`, the surrogate the session's vehicle map
     is keyed by.
   - Priorities rebucketed so managed objects sort ahead of GTFS objects:
     trackers 0, stations 1, routes 2, plain stops 3. */
/**
 * Turns the loaded session into search entries for `SearchController`.
 *
 * The payload is a `PageState`, so a selected result goes through `setFocus`
 * like any other navigation and the panel, map and hash all follow.
 *
 * Trackers come from the session's live map, so they are as fresh as the last
 * event — entries are rebuilt per query, which is what makes that free.
 */

import { CONFIG } from '../config';
import type { PageState } from '../types/page-state';
import type { FeedSession } from './feed-session';
import { vehicleDisplayName } from './render-utils';
import {
  dotMarker,
  routeMarker,
  stopMarker,
  type SearchEntry,
} from './search-controller';

/** Non-empty values only, so the haystack has no runs of blanks to match into. */
function haystack(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function buildSearchEntries(session: FeedSession): SearchEntry<PageState>[] {
  const feed = session.staticFeed;
  const entries: SearchEntry<PageState>[] = [];

  for (const stop of feed?.stops.values() ?? []) {
    entries.push({
      payload: { type: 'stop', stop_id: stop.id },
      icon: stopMarker(stop.location_type),
      primary: stop.name || stop.id,
      secondary: stop.raw['stop_code'] || stop.id,
      haystack: haystack(stop.name, stop.id, stop.raw['stop_code'], stop.raw['stop_desc']),
      // Managed objects first, then stations, routes, and plain stops.
      priority: Number(stop.location_type) === 1 ? 1 : 3,
    });
  }

  for (const route of feed?.routes.values() ?? []) {
    const primary = route.short_name || route.long_name || route.id;
    entries.push({
      payload: { type: 'route', route_id: route.id },
      icon: routeMarker(route.color),
      primary,
      secondary: route.long_name && route.long_name !== primary ? route.long_name : route.id,
      haystack: haystack(route.short_name, route.long_name, route.id, route.raw['route_desc']),
      priority: 2,
    });
  }

  // Trackers are keyed by `Tracker.id` in `session.vehicles`, which is what the
  // map paints and what a link carries.
  for (const tracker of session.vehicles.values()) {
    // Same color the map paints it: the assigned trip's route, or unmatched grey.
    const routeId = tracker.routeId || (tracker.tripId ? feed?.trips.get(tracker.tripId)?.route_id : undefined);
    const color = (routeId ? feed?.routes.get(routeId)?.color : undefined) ?? CONFIG.VEHICLE_UNMATCHED_COLOR;
    entries.push({
      payload: { type: 'tracker', tracker_id: tracker.key },
      icon: dotMarker(color),
      primary: vehicleDisplayName(feed, tracker),
      secondary: tracker.vehicleId || tracker.key,
      haystack: haystack(
        vehicleDisplayName(feed, tracker),
        tracker.vehicleId,
        tracker.label,
        tracker.tripId,
        routeId,
      ),
      priority: 0,
    });
  }

  return entries;
}
