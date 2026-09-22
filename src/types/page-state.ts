/* @vendored-from test-track:src/types/page-state.ts
   @sha 968e2de
   @status modified
   @changes
   - Variants replaced wholesale. yard-master browses a hierarchy neither
     upstream has: `tracker` is a managed object from the API, `route`, `stop`
     and `trip` come from the in-browser GTFS. Dropped `vehicle`; kept `alert`,
     which here is a managed object rather than a decoded GTFS-RT entity.
     `vehicle` came back later as this repo's own: one live vehicle of a
     tracker carrying several, keyed by `VehiclePosition.key`.
   - `home` is the feed itself: its own properties, its children, and the facts
     about it. There is no separate `feed` variant.
   - Seven variants and a maximum depth of three. There are no list variants: a
     list is a scrollbox on the page of the object that owns it, never a page,
     so no crumb is ever a category.
   - `MODAL_TYPES` is `alerts` and `help`, this repo's two of upstream's editor
     list. They are the navbar modals worth linking to: an alert list over
     whatever page you are on, and a guide page. The calendar and sharing stay
     unrouted — each carries state the hash would not (the calendar's month and
     tab), and neither is a view to send somebody. The feed switcher stays
     unrouted for upstream's load-modal reason: it edits the selection, and the
     selection is already in the hash as `feed`.
   - No `TimetableModalState`/`PaneModalState` split: neither modal here needs
     more than one optional selector, and only `help` needs any.
   - `page` names the guide page the modal *opens* on, not the one showing:
     `sidebar-modal.ts` has no hook for a pane change and is `verbatim`, so
     teaching it one is an upstream change rather than a local edit.
   - `tracker` is keyed by `Tracker.id`, the surrogate. It is not the Traccar
     credential (that is `device_key`, which never leaves the properties panel)
     and it is genuinely unique, which nickname is not.
   - `trip` added, with `route_id` alongside `trip_id` so a trip page can render
     its breadcrumb before the zip has finished parsing.
   - `isPageState` no longer counts keys per variant; the optional members make
     an exact-count check say nothing useful, so each field is checked by type.
     The modal is destructured out and validated on its own, which is the whole
     of what the modal dimension costs the guard here.
   - `pageStatesEqual` compares the location and the modal separately rather
     than stringifying the whole state, so a modal added to a state does not
     depend on key order. `sameLocation` is the location half on its own: it is
     what tells a modal-only navigation from a page change.
   - `BreadcrumbItem` moved out to `interlocking`'s `breadcrumb-trail.ts`; it
     now carries a `typeLabel` this file has no reason to know about.
   - `ModalStateOf` follows upstream's drop: `modal-router.ts` narrows an
     opener's argument itself now. */

/**
 * Union of every page yard-master can display. Each variant carries the minimal
 * set of object keys needed to identify and restore the page.
 *
 * `home` is the no-feed-selected state. Everything else is scoped to the
 * feed named by the hash's `feed` param, which is not part of PageState: the
 * feed is selection, not focus, and `PageStateManager.setFeedParams()` owns it.
 */
export type PageLocation =
  | { type: 'home' }
  | { type: 'tracker'; tracker_id: string }
  | { type: 'vehicle'; tracker_id: string; vehicle_key: string }
  | { type: 'alert'; alert_id: string }
  | { type: 'route'; route_id: string }
  | { type: 'stop'; stop_id: string }
  | { type: 'trip'; trip_id: string; route_id?: string };

/**
 * The modals that live in the URL hash. The calendar, sharing and the feed
 * switcher are deliberately absent: the first two hold state the hash does not
 * carry, and the third edits the feed selection, which is in the hash already.
 */
export const MODAL_TYPES = ['alerts', 'help'] as const;

export type ModalType = (typeof MODAL_TYPES)[number];

/**
 * A modal is orthogonal to the page beneath it: closing one returns to that
 * page rather than to a separate page state.
 */
export type ModalState = { type: 'alerts' } | { type: 'help'; page?: string };

/** Distributed so that narrowing on `type` still works through the modal field. */
type WithModal<T> = T extends unknown ? T & { modal?: ModalState } : never;

export type PageState = WithModal<PageLocation>;

export type PageStateType = PageLocation['type'];

/** Type guard for a valid ModalState. */
export function isModalState(value: unknown): value is ModalState {
  if (!value || typeof value !== 'object') return false;

  const modal = value as { type?: unknown; page?: unknown };
  if (!MODAL_TYPES.includes(modal.type as ModalType)) return false;

  if (modal.type === 'help') {
    if (modal.page !== undefined && typeof modal.page !== 'string') return false;
    return Object.keys(modal).every((k) => k === 'type' || k === 'page');
  }
  return Object.keys(modal).length === 1;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** Type guard for a valid PageState. */
export function isPageState(value: unknown): value is PageState {
  if (!value || typeof value !== 'object') return false;

  // The modal dimension is validated on its own; the checks below are about
  // the page underneath it.
  const { modal, ...state } = value as Record<string, unknown>;
  if (modal !== undefined && !isModalState(modal)) return false;
  if (typeof state.type !== 'string') return false;

  switch (state.type) {
    case 'home':
      return true;

    case 'tracker':
      return typeof state.tracker_id === 'string';

    case 'vehicle':
      return typeof state.tracker_id === 'string' && typeof state.vehicle_key === 'string';

    case 'alert':
      return typeof state.alert_id === 'string';

    case 'route':
      return typeof state.route_id === 'string';

    case 'stop':
      return typeof state.stop_id === 'string';

    case 'trip':
      return typeof state.trip_id === 'string' && isOptionalString(state.route_id);

    default:
      return false;
  }
}

/** Two states name the same page when the modal above them is ignored. */
export function sameLocation(a: PageState, b: PageState): boolean {
  const { modal: _aModal, ...aLocation } = a;
  const { modal: _bModal, ...bLocation } = b;
  return JSON.stringify(aLocation) === JSON.stringify(bLocation);
}

/** Two states are equal when they name the same object with the same options. */
export function pageStatesEqual(a: PageState, b: PageState): boolean {
  return (
    sameLocation(a, b) && JSON.stringify(a.modal ?? null) === JSON.stringify(b.modal ?? null)
  );
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
