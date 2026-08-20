/**
 * Application-wide configuration constants.
 * All magic numbers live here, import CONFIG rather than inlining literals.
 *
 * The map and realtime blocks are the constants the vendored map stack reads.
 * They came across with those files (see VENDORED.md) and are kept in the same
 * order as test-track's so the two are diffable.
 */
export const CONFIG = {
  // Same-origin in every environment. In production Traefik routes
  // manage.rt.gtfs.zone/api/* to cafe-car's admin app; in dev vite proxies it
  // to localhost:8001 with forged oauth2-proxy headers. Never an absolute URL:
  // a cross-origin API would need CORS and credentialed preflights that
  // production deliberately does not have.
  API_BASE: '/api',

  // Header that makes a write ineligible for a cross-site form post. A simple
  // request cannot carry it, so its presence proves the caller ran our JS.
  CSRF_HEADER: 'X-Yard-Master',

  // localStorage keys. Per-device preferences, deliberately not in the URL.
  MAP_VIEW_KEY: 'ym.map.view',
  MAP_APPEARANCE_KEY: 'ym.map.appearance',
  SELECTED_FEED_KEY: 'ym.feed',

  // Map navigation.
  STOP_FOCUS_ZOOM: 16,
  FOCUS_POINT_DURATION: 1500,
  FOCUS_BOUNDS_DURATION: 2000,

  // Camera ease used while following a moving tracker. Short so it never
  // queues behind the next position push.
  FOLLOW_DURATION: 300,

  // Debounce for persisting the map view on moveend.
  MAP_VIEW_SAVE_DEBOUNCE: 400,

  // Zoom range over which plain stops fade in/out. Shared between
  // LayerManager's fade-opacity expression and its click-area hit radius so
  // hidden stops are never hoverable/clickable. Changing one without the other
  // produces ghost clicks on invisible stops.
  STOP_FADE_ZOOM_MIN: 10.5,
  STOP_FADE_ZOOM_MAX: 12.5,

  // The same fade applied to stations and child nodes, pitched lower. Must sit
  // below STOP_FADE_ZOOM_MIN or the two bands overlap and stations fade back
  // out as plain stops fade in.
  STATION_FADE_ZOOM_MIN: 7.5,
  STATION_FADE_ZOOM_MAX: 9.5,

  // Spotlight treatment when a route (and its stops) is focused. Non-matching
  // routes and stops dim; the matched route's line and casing get a width bump.
  SPOTLIGHT_STOP_DIM: 0.15,
  SPOTLIGHT_ROUTE_DIM: 0.2,
  SPOTLIGHT_LINE_BUMP: 1.35,
  SPOTLIGHT_CASING_BUMP: 1.3,

  // Opacity for vehicles not on the focused route. Higher than the route dim:
  // a vehicle is a small mark and needs more opacity than a long line to read
  // at the same visual weight.
  SPOTLIGHT_VEHICLE_DIM: 0.25,

  // line-sort-key applied to the focused route so it paints above every other
  // route. Far above any natural key (max ~90999).
  SPOTLIGHT_SORT_KEY: 1_000_000,

  // Trips listed on a route page before the list is capped. A busy route has
  // thousands; the page says how many it left out.
  ROUTE_TRIP_LIST_MAX: 200,

  // Stops listed in the tree's Stops section before it is capped, and the
  // routes/stops/trips a tree section shows a count for. A large feed has tens
  // of thousands of stops and the panel is not the place to page through them.
  TREE_LIST_MAX: 200,

  // Neutral fill for a vehicle whose trip/route cannot be resolved against the
  // static feed.
  VEHICLE_UNMATCHED_COLOR: '#94a3b8',

  // Realtime poll interval, read by the vendored poller. Per-device, so it is
  // deliberately not in the hash.
  RT_INTERVAL_KEY: 'ym.rt.interval',
  RT_INTERVAL_DEFAULT_MS: 15000,
  RT_INTERVAL_OPTIONS_MS: [5000, 10000, 15000, 30000, 60000],

  // Tracker liveness. Positions carry a 60s TTL in Redis, so anything older
  // than that is not "stale", it is gone.
  TRACKER_STALE_MS: 60_000,

  // Where a path-only feed URL resolves to. Dev is the music-student stack's
  // cafe-car (`docker-compose.yml`, service `api`); prod is the deployed feed
  // server. Read by the vendored `feed-url-resolve.ts`, which is shared with
  // coloring-book and so cannot hardcode either.
  RT_BASE: import.meta.env.DEV ? 'http://localhost:8000' : 'https://rt.gtfs.zone',

  // Prod URLs of the sibling apps, for deep links out of a properties page.
  VIZ_BASE: 'https://viz.rt.gtfs.zone',
  EDITOR_BASE: 'https://edit.gtfs.zone',
} as const;
