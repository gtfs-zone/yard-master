/* @vendored-from test-track:src/types/page-state.ts
   @sha 4be8cb1
   @status modified
   @changes
   - Variants replaced wholesale. yard-master browses a hierarchy neither
     upstream has: `tracker` is a managed object from the API, `route`, `stop`
     and `trip` come from the in-browser GTFS. Dropped `vehicle`; kept `alert`,
     which here is a managed object rather than a decoded GTFS-RT entity.
   - `home` is the feed itself: its own properties, its children, and the facts
     about it. There is no separate `feed` variant.
   - Six variants and a maximum depth of three. There are no list variants: a
     list is a scrollbox on the page of the object that owns it, never a page,
     so no crumb is ever a category. The calendar, sharing and the alert list
     are navbar modals rather than pages and carry no state here.
   - `tracker` is keyed by `Tracker.id`, the surrogate. It is not the Traccar
     credential (that is `device_key`, which never leaves the properties panel)
     and it is genuinely unique, which nickname is not.
   - `trip` added, with `route_id` alongside `trip_id` so a trip page can render
     its breadcrumb before the zip has finished parsing.
   - `isPageState` no longer counts keys per variant; the optional members make
     an exact-count check say nothing useful, so each field is checked by type.
   - `BreadcrumbItem` moved out to `breadcrumb-trail.ts`, vendored from
     coloring-book; it now carries a `typeLabel` this file has no reason to know
     about. */

/**
 * Union of every page yard-master can display. Each variant carries the minimal
 * set of object keys needed to identify and restore the page.
 *
 * `home` is the no-feed-selected state. Everything else is scoped to the
 * feed named by the hash's `feed` param, which is not part of PageState: the
 * feed is selection, not focus, and `PageStateManager.setFeedParams()` owns it.
 */
export type PageState =
  | { type: 'home' }
  | { type: 'tracker'; tracker_id: string }
  | { type: 'alert'; alert_id: string }
  | { type: 'route'; route_id: string; direction_id?: string }
  | { type: 'stop'; stop_id: string }
  | { type: 'trip'; trip_id: string; route_id?: string };

export type PageStateType = PageState['type'];

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** Type guard for a valid PageState. */
export function isPageState(value: unknown): value is PageState {
  if (!value || typeof value !== 'object') return false;

  const state = value as Record<string, unknown>;
  if (typeof state.type !== 'string') return false;

  switch (state.type) {
    case 'home':
      return true;

    case 'tracker':
      return typeof state.tracker_id === 'string';

    case 'alert':
      return typeof state.alert_id === 'string';

    case 'route':
      return typeof state.route_id === 'string' && isOptionalString(state.direction_id);

    case 'stop':
      return typeof state.stop_id === 'string';

    case 'trip':
      return typeof state.trip_id === 'string' && isOptionalString(state.route_id);

    default:
      return false;
  }
}

/** Two states are equal when they name the same object with the same options. */
export function pageStatesEqual(a: PageState, b: PageState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Navigation event emitted on every focus change. */
export type NavigationEvent = {
  from: PageState;
  to: PageState;
  timestamp: number;
};

export type PageStateManagerConfig = {
  enableHistory: boolean;
  maxHistoryLength: number;
  enableUrlSync: boolean;
};

/**
 * Checks whether a page state refers to an object that exists in the currently
 * loaded feed. Returns false and the caller falls back to home.
 *
 * Synchronous, unlike coloring-book's: our model is a set of in-memory maps and
 * API responses, not a database.
 */
export type StateValidator = (state: PageState) => boolean;
