/* @vendored-from test-track:src/modules/search-entries.ts
   @sha fdb171c
   @status modified
   @changes
   - The vehicle loop became a tracker loop over the API's tracker list rather
     than the live vehicle map, so a tracker that has never reported a fix is
     still findable. The payload is a `tracker` PageState keyed by `Tracker.id`,
     which is the key both maps use.
   - A tracker running several vehicles also gets one entry per live vehicle,
     payload from `vehicleLocation`, beside the tracker's own entry, which then
     reads as the fleet ("N vehicles") rather than as one of them.
   - A managed service alert loop added, keyed by `String(Alert.id)`.
   - Priorities rebucketed so managed objects sort ahead of GTFS objects:
     trackers 0, alerts 1, stations 2, routes 3, plain stops 4. */
/**
 * Turns the loaded session into search entries for `SearchController`.
 *
 * The payload is a `PageState`, so a selected result goes through `setFocus`
 * like any other navigation and the panel, map and hash all follow.
 *
 * Both halves of the hierarchy are searchable from one box. Managed objects —
 * trackers and service alerts — come from the API lists and are bucketed ahead
 * of everything the zip carries, because they are what somebody opening this
 * app came to find. Entries are rebuilt per query, so nothing goes stale.
 */

import { CONFIG } from '../config';
import type { PageState } from '../types/page-state';
import type { FeedSession } from './feed-session';
import type { VehiclePosition } from '../map-controller';
import { vehicleLocation } from './vehicle-location';
import { vehicleDisplayName } from 'interlocking/gtfs/entity-render';
import {
  dotMarker,
  routeMarker,
  stopMarker,
  type SearchEntry,
} from 'interlocking/ui/search-controller';

// Alerts have no map feature and so no color of their own; amber reads as the
// warning it is against every basemap.
const ALERT_MARKER_COLOR = '#f59e0b';

/** Non-empty values only, so the haystack has no runs of blanks to match into. */
function haystack(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function buildSearchEntries(session: FeedSession): SearchEntry<PageState>[] {
  const feed = session.scheduledFeed;
  const entries: SearchEntry<PageState>[] = [];

  for (const stop of feed?.stops.values() ?? []) {
    entries.push({
      payload: { type: 'stop', stop_id: stop.id },
      icon: stopMarker(stop.location_type),
      primary: stop.name || stop.id,
      secondary: stop.raw['stop_code'] || stop.id,
      haystack: haystack(stop.name, stop.id, stop.raw['stop_code'], stop.raw['stop_desc']),
      // Managed objects first, then stations, routes, and plain stops.
      priority: Number(stop.location_type) === 1 ? 2 : 4,
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
      priority: 3,
    });
  }

  // Same color the map paints a vehicle: its trip's route, or unmatched grey.
  const vehicleRoute = (position: VehiclePosition | undefined) =>
    position?.routeId || (position?.tripId ? feed?.trips.get(position.tripId)?.route_id : undefined);
  const vehicleColor = (routeId: string | undefined) =>
    (routeId ? feed?.routes.get(routeId)?.color : undefined) ?? CONFIG.VEHICLE_UNMATCHED_COLOR;

  // A tracker is searched for as itself, whether or not it is reporting: the
  // list is the API's, not the live map's. A one-vehicle tracker is that
  // vehicle, so its fix colors and describes the row; a fleet is described as
  // a fleet, and each of its vehicles is an entry of its own.
  for (const tracker of session.trackers.values()) {
    const positions = session.vehiclesFor(tracker.id);
    const fleet = positions.length > 1;
    const [position] = positions;
    const routeId = fleet ? undefined : vehicleRoute(position);
    entries.push({
      payload: { type: 'tracker', tracker_id: tracker.id },
      icon: dotMarker(vehicleColor(routeId)),
      primary: tracker.nickname,
      secondary: fleet
        ? `${positions.length} vehicles`
        : position
          ? vehicleDisplayName(feed, position)
          : 'no fix',
      haystack: fleet
        ? haystack(tracker.nickname)
        : haystack(tracker.nickname, position?.label, position?.tripId, routeId),
      priority: 0,
    });

    if (!fleet) continue;
    for (const vehicle of positions) {
      const vehicleRouteId = vehicleRoute(vehicle);
      entries.push({
        payload: vehicleLocation(positions, vehicle),
        icon: dotMarker(vehicleColor(vehicleRouteId)),
        primary: vehicle.label || vehicle.vehicleId,
        secondary: [tracker.nickname, vehicle.tripId ? feed?.trips.get(vehicle.tripId)?.headsign : undefined]
          .filter(Boolean)
          .join(' - '),
        haystack: haystack(vehicle.label, vehicle.vehicleId, vehicle.tripId, vehicleRouteId),
        priority: 0,
      });
    }
  }

  for (const alert of session.serviceAlerts.values()) {
    entries.push({
      payload: { type: 'alert', alert_id: String(alert.id) },
      icon: dotMarker(ALERT_MARKER_COLOR),
      primary: alert.header_text || `Alert ${alert.id}`,
      secondary: alert.effect ?? alert.cause ?? undefined,
      haystack: haystack(
        alert.header_text,
        alert.description_text,
        alert.cause ?? undefined,
        alert.effect ?? undefined
      ),
      priority: 1,
    });
  }

  return entries;
}
