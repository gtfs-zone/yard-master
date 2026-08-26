/**
 * The ids an informed-entity form offers, built from the schedule this browser
 * has parsed.
 *
 * An alert names a route, a stop or an agency by its GTFS id, and typing one
 * from memory is how an alert ends up applying to nothing. So each id field is
 * a combo over what is actually in the loaded zip.
 *
 * Every list is allowed to be empty. `static_feed_url` can be unreachable, a
 * hosted feed can have no upload yet, and the parse can still be running — all
 * normal states here. The combo stays a text input in that case, because the
 * id is still writable: the server does not check it against the schedule
 * either, and an alert written now is right as soon as the zip loads.
 */

import type { GTFSStatic } from '../gtfs-static';
import type { FieldOption } from './entity-form';

/** What a combo says when there is no schedule to suggest from. */
export const NO_SCHEDULE =
  'The schedule has not loaded in this browser, so there is nothing to suggest. Type the id exactly as the feed spells it.';

/**
 * `route_type` names, for labelling only.
 *
 * The values a combo offers come from the feed's own `routes.txt`; this only
 * says what one means. Extended route types have no entry and show the bare
 * number, which is what the reference calls them too.
 */
const ROUTE_TYPE_NAMES: Record<number, string> = {
  0: 'Tram, streetcar or light rail',
  1: 'Subway or metro',
  2: 'Rail',
  3: 'Bus',
  4: 'Ferry',
  5: 'Cable tram',
  6: 'Aerial lift',
  7: 'Funicular',
  11: 'Trolleybus',
  12: 'Monorail',
};

export function agencyOptions(feed: GTFSStatic | null): FieldOption[] {
  if (!feed) return [];
  // A single-agency feed may leave `agency_id` blank, and a blank id is not an
  // id: offering it would put an empty string in the request body.
  return feed.agencies
    .filter((agency) => agency.id)
    .map((agency) => ({ value: agency.id, label: agency.id, detail: agency.name }));
}

export function routeOptions(feed: GTFSStatic | null): FieldOption[] {
  if (!feed) return [];
  return [...feed.routes.values()].map((route) => ({
    value: route.id,
    label: route.id,
    detail: [route.short_name, route.long_name].filter(Boolean).join(' - '),
  }));
}

export function stopOptions(feed: GTFSStatic | null): FieldOption[] {
  if (!feed) return [];
  return [...feed.stops.values()].map((stop) => ({
    value: stop.id,
    label: stop.id,
    detail: stop.name,
  }));
}

/** The distinct `route_type` values this feed uses, with how many routes each. */
export function routeTypeOptions(feed: GTFSStatic | null): FieldOption[] {
  if (!feed) return [];
  const counts = new Map<number, number>();
  for (const route of feed.routes.values()) {
    counts.set(route.type, (counts.get(route.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([type, count]) => ({
      value: String(type),
      label: ROUTE_TYPE_NAMES[type] ? `${type} — ${ROUTE_TYPE_NAMES[type]}` : String(type),
      detail: `${count} route${count === 1 ? '' : 's'}`,
    }));
}

/**
 * `direction_id` 0 and 1, with examples of what each one means in this feed.
 *
 * The number alone says nothing — the spec only requires the two to be
 * opposites — so the headsigns are the whole reason this is a combo rather
 * than a number input. They are examples and are labelled as such: the form
 * does not know which route is being named yet, so these are drawn from the
 * whole feed and a given route may use neither of them.
 */
export function directionOptions(feed: GTFSStatic | null): FieldOption[] {
  if (!feed) return [];
  const counts = new Map<string, Map<string, number>>([
    ['0', new Map()],
    ['1', new Map()],
  ]);
  for (const trip of feed.trips.values()) {
    const bucket = counts.get(trip.direction_id);
    if (!bucket || !trip.headsign) continue;
    bucket.set(trip.headsign, (bucket.get(trip.headsign) ?? 0) + 1);
  }
  return ['0', '1'].map((direction) => {
    // The busiest three: a feed with fifty headsigns per direction is not made
    // clearer by listing them, and the rarest ones are the least recognisable.
    const top = [...(counts.get(direction) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([headsign]) => headsign);
    return {
      value: direction,
      label: direction,
      detail: top.length ? `e.g. ${top.join(' - ')}` : '',
    };
  });
}
