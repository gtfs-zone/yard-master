/* @vendored-from test-track:src/modules/page-state-manager.ts
   @sha c24eb5b
   @status adopted
   @changes
   - The `PageStateManager` class is `interlocking`'s `ui/page-state-manager.ts`
     now, generic over the page-state union, as it is upstream. What is left
     here is this app's hash codec, which the shared class is constructed with.
   - The codec is rewritten for yard-master's seven variants. The hash carries
     an explicit `type` param and the codec switches on it, rather than telling
     the pages apart by which object key is present the way test-track's can.
   - A tracker appears in the hash as `tracker=<Tracker.id>`. The surrogate is
     not a secret and is unique; `device_key` is the credential and never
     reaches a URL, and nickname is a label that may repeat.
   - A vehicle appears as `tracker=<Tracker.id>&vehicle=<VehiclePosition.key>`.
     The key is opaque here: the server builds it and nothing in the browser
     parses it. A hash missing either param falls back to home.
   - Every variant but `home` names an object, so a hash missing that object's
     key falls back to home. So does any `type` the switch does not know, which
     is what retires the list, `service`, `assignments` and `managers` hashes
     without a migration.
   - Because the codec switches on an explicit `type` rather than sniffing
     which object key is present, every one of `fromParams`'s returns is
     wrapped in `withModal`, the fallbacks to home included. That is what makes
     a hash naming only a modal open it over home. */

import type { PageStateCodec } from 'interlocking/ui/page-state-manager';
import { PageStateManager } from 'interlocking/ui/page-state-manager';
import type { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import type { ModalState, ModalType, PageState } from '../types/page-state';
import { MODAL_TYPES, isPageState } from '../types/page-state';

/**
 * Read the modal dimension out of a parsed hash. An unknown modal name is
 * dropped rather than throwing: the hash is user-editable.
 */
function parseModalParams(params: URLSearchParams): ModalState | null {
  const type = params.get('modal');
  if (type === null) return null;
  if (!MODAL_TYPES.includes(type as ModalType)) {
    console.warn(`[PageStateManager] unknown modal in hash: ${type}`);
    return null;
  }
  if (type === 'help') {
    const page = params.get('modal_page');
    return { type: 'help', ...(page !== null && { page }) };
  }
  return { type: 'alerts' };
}

const pageStateCodec: PageStateCodec<PageState> = {
  isPageState,

  toParams(pageState) {
    const params = new URLSearchParams();
    if (pageState.type !== 'home') params.set('type', pageState.type);

    switch (pageState.type) {
      case 'home':
        break;
      case 'route':
        params.set('route', pageState.route_id);
        break;
      case 'stop':
        params.set('stop', pageState.stop_id);
        break;
      case 'tracker':
        // The surrogate, never `device_key`.
        params.set('tracker', pageState.tracker_id);
        break;
      case 'vehicle':
        params.set('tracker', pageState.tracker_id);
        params.set('vehicle', pageState.vehicle_key);
        break;
      case 'trip':
        params.set('trip', pageState.trip_id);
        if (pageState.route_id) params.set('route', pageState.route_id);
        break;
      case 'alert':
        params.set('alert', pageState.alert_id);
        break;
    }

    // The modal rides on top of whatever page is beneath it, home included.
    // Its params are prefixed so they cannot collide with the page's or with
    // the feed params the manager merges in.
    const modal = pageState.modal;
    if (modal) {
      params.set('modal', modal.type);
      if (modal.type === 'help' && modal.page) {
        params.set('modal_page', modal.page);
      }
    }

    return params;
  },

  /**
   * Driven by the explicit `type` param; anything unrecognised, or a variant
   * missing the object key it needs, falls back to home rather than producing
   * a state no page can render. A hash naming a retired variant —
   * the list pages, `service`, `assignments`, `managers`, `feed`, `tree`,
   * `people` — lands there too, so no migration is needed.
   *
   * The modal is read separately and carried onto whichever page results, the
   * home fallbacks included: a modal names no object, so nothing the page half
   * fails to resolve can invalidate it.
   */
  fromParams(params) {
    const get = (key: string) => params.get(key) ?? undefined;
    const modal = parseModalParams(params);
    const withModal = (state: PageState): PageState => (modal ? { ...state, modal } : state);

    switch (params.get('type')) {
      case 'tracker': {
        const tracker_id = get('tracker');
        return withModal(
          tracker_id === undefined ? { type: 'home' } : { type: 'tracker', tracker_id },
        );
      }
      case 'vehicle': {
        const tracker_id = get('tracker');
        const vehicle_key = get('vehicle');
        return withModal(
          tracker_id === undefined || vehicle_key === undefined
            ? { type: 'home' }
            : { type: 'vehicle', tracker_id, vehicle_key },
        );
      }
      case 'alert': {
        const alert_id = get('alert');
        return withModal(alert_id === undefined ? { type: 'home' } : { type: 'alert', alert_id });
      }
      case 'route': {
        const route_id = get('route');
        return withModal(route_id === undefined ? { type: 'home' } : { type: 'route', route_id });
      }
      case 'stop': {
        const stop_id = get('stop');
        return withModal(stop_id === undefined ? { type: 'home' } : { type: 'stop', stop_id });
      }
      case 'trip': {
        const trip_id = get('trip');
        if (trip_id === undefined) return withModal({ type: 'home' });
        const route_id = get('route');
        return withModal({ type: 'trip', trip_id, ...(route_id !== undefined && { route_id }) });
      }
      default:
        return withModal({ type: 'home' });
    }
  },
};

export type AppPageStateManager = PageStateManager<PageState, BreadcrumbItem<PageState>>;

/** The one manager AppState owns, synced to the hash. */
export function createPageStateManager(): AppPageStateManager {
  return new PageStateManager({ codec: pageStateCodec, enableUrlSync: true });
}
