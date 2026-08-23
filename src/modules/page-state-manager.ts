/* @vendored-from test-track:src/modules/page-state-manager.ts
   @sha 56f120a
   @status modified
   @changes
   - `pageStateToURL` / `urlToPageState` rewritten for yard-master's variants.
     The hash now carries an explicit `type` param, because `feed`,
     `assignments` and `managers` name no object and cannot be told apart by the
     presence of an object key the way test-track's four pages could.
   - A tracker appears in the hash as `tracker=<Tracker.id>`. The surrogate is
     not a secret and is unique; `device_key` is the credential and never
     reaches a URL, and nickname is a label that may repeat.
   - The four list variants (`routes`, `stops`, `trackers`, `alerts`) name no
     object, so they carry the `type` param and nothing else. `tree` and `feed`
     are read as aliases of home, for hashes written before this page settled.
   - Added `syncHash()`. `adoptState` is deliberately silent, but a focus
     restored from a link still has to survive the feed params being written
     around it, and this module is the only thing allowed to touch the hash. */
/* @vendored-from coloring-book:src/modules/page-state-manager.ts
   @sha a4b5ee1
   @status modified
   @changes
   - Reduced to test-track's five page variants; all `agency` / `timetable` /
     `service` / `pathway` branches deleted.
   - `BreadcrumbLookup` interface and `getObjectName` deleted. Breadcrumbs are now
     built by an injected synchronous `BreadcrumbBuilder` (see breadcrumbs.ts),
     because our model is in-memory rather than IndexedDB-backed.
   - `StateValidator` is synchronous, so `setPageState` / `initializeFromURL` /
     `handleHashChange` are no longer async.
   - Added `setFeedParams()`: the hash carries the feed configuration alongside the
     focus, so `pageStateToURL` output is merged with those params on every write.
     coloring-book instead stripped a single `load=` command param.
   - `CONFIG.MAX_NAVIGATION_HISTORY` inlined — test-track has no config module.
   - Dropped the module-level singleton (`getPageStateManager` /
     `initPageStateManager`); AppState owns the one instance.
   - Skipped `136329b`: the `zone` and `location_group` branches in
     `getBreadcrumbs`, `pageStateToURL` and `urlToPageState`, plus the two
     `BreadcrumbLookup` name getters, are GTFS Flex pages test-track has no
     data for. */

import type {
  BreadcrumbItem,
  NavigationEvent,
  PageState,
  PageStateManagerConfig,
  StateValidator,
} from '../types/page-state';
import { isPageState } from '../types/page-state';

const MAX_NAVIGATION_HISTORY = 50;

type NavigationEventHandler = (event: NavigationEvent) => void;

/** Resolves a page state to its breadcrumb trail against the loaded feed. */
export type BreadcrumbBuilder = (state: PageState) => BreadcrumbItem[];

/** Single source of truth for what the app is currently looking at. */
export class PageStateManager {
  private currentState: PageState = { type: 'home' };
  private navigationHistory: NavigationEvent[] = [];
  private eventHandlers: NavigationEventHandler[] = [];
  private config: PageStateManagerConfig;
  private breadcrumbBuilder: BreadcrumbBuilder | null = null;
  private stateValidator: StateValidator | null = null;
  private feedParams: Record<string, string> = {};
  private suppressHashUpdate = false;

  constructor(config: Partial<PageStateManagerConfig> = {}) {
    this.config = {
      enableHistory: true,
      maxHistoryLength: MAX_NAVIGATION_HISTORY,
      enableUrlSync: false,
      ...config,
    };

    if (this.config.enableUrlSync && typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => this.handleHashChange());
    }
  }

  setBreadcrumbBuilder(builder: BreadcrumbBuilder): void {
    this.breadcrumbBuilder = builder;
  }

  /**
   * Set the validator used to check that a restored state still names an object
   * in the loaded feed. Returns false to fall back to home.
   */
  setStateValidator(fn: StateValidator): void {
    this.stateValidator = fn;
  }

  /**
   * Replace the feed-configuration half of the hash. Written on the next state
   * change, or immediately when `writeNow` is set — the selection can change
   * while the focus does not.
   */
  setFeedParams(params: Record<string, string>, writeNow = true): void {
    this.feedParams = params;
    if (writeNow) this.writeHash(this.currentState);
  }

  getFeedParams(): Record<string, string> {
    return { ...this.feedParams };
  }

  getPageState(): PageState {
    return { ...this.currentState };
  }

  /** Update the current state, recording history and syncing the hash. */
  setPageState(newState: PageState): void {
    if (!isPageState(newState)) {
      throw new Error('Invalid page state provided');
    }

    const previousState = this.currentState;
    this.currentState = { ...newState };

    const navigationEvent: NavigationEvent = {
      from: previousState,
      to: newState,
      timestamp: Date.now(),
    };

    this.recordHistory(navigationEvent);
    this.writeHash(newState);
    this.notify(navigationEvent);
  }

  getBreadcrumbs(): BreadcrumbItem[] {
    if (!this.breadcrumbBuilder) return [];
    try {
      return this.breadcrumbBuilder(this.currentState);
    } catch (error) {
      console.error('Error building breadcrumbs:', error);
      return [];
    }
  }

  navigateTo(pageState: PageState): void {
    this.setPageState(pageState);
  }

  canNavigateBack(): boolean {
    return this.navigationHistory.length > 0;
  }

  /** Step back to the most recent state that differs from the current one. */
  navigateBack(): boolean {
    if (!this.canNavigateBack()) return false;

    const currentStateStr = JSON.stringify(this.currentState);
    for (let i = this.navigationHistory.length - 1; i >= 0; i--) {
      const fromStateStr = JSON.stringify(this.navigationHistory[i].from);
      if (fromStateStr !== currentStateStr) {
        this.setPageState(this.navigationHistory[i].from);
        return true;
      }
    }
    return false;
  }

  addNavigationHandler(handler: NavigationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  removeNavigationHandler(handler: NavigationEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index >= 0) this.eventHandlers.splice(index, 1);
  }

  getNavigationHistory(): NavigationEvent[] {
    return [...this.navigationHistory];
  }

  clearNavigationHistory(): void {
    this.navigationHistory = [];
  }

  /** The focus named by the hash at boot, before any feed has loaded. */
  pendingStateFromURL(): PageState {
    if (typeof window === 'undefined') return { type: 'home' };
    return this.urlToPageState(window.location.hash.slice(1));
  }

  /**
   * Adopt a state without dispatching navigation events — used at boot, once
   * the feed has parsed and the validator can actually answer.
   */
  adoptState(state: PageState): void {
    if (state.type !== 'home' && this.stateValidator && !this.stateValidator(state)) {
      this.currentState = { type: 'home' };
      return;
    }
    this.currentState = { ...state };
  }

  /** Write the current state to the hash without dispatching anything. */
  syncHash(): void {
    this.writeHash(this.currentState);
  }

  /** Focus params only; the feed half is merged in by `writeHash`. */
  pageStateToURL(pageState: PageState): string {
    const params = new URLSearchParams();
    if (pageState.type !== 'home') params.set('type', pageState.type);

    switch (pageState.type) {
      case 'home':
        break;
      case 'route':
        params.set('route', pageState.route_id);
        if (pageState.direction_id) params.set('dir', pageState.direction_id);
        break;
      case 'stop':
        params.set('stop', pageState.stop_id);
        break;
      case 'tracker':
        // The surrogate, never `device_key`.
        params.set('tracker', pageState.tracker_id);
        break;
      case 'trip':
        params.set('trip', pageState.trip_id);
        if (pageState.route_id) params.set('route', pageState.route_id);
        break;
      case 'alert':
        params.set('alert', pageState.alert_id);
        break;
    }

    return params.toString();
  }

  /**
   * Read the focus out of a hash string (no leading `#`), ignoring the feed
   * params. Driven by the explicit `type` param; anything unrecognised, or a
   * variant missing the object key it needs, falls back to home rather than
   * producing a state no page can render. A hash naming a retired variant —
   * the list pages, `service`, `assignments`, `managers`, `feed`, `tree`,
   * `people` — lands there too, so no migration is needed.
   */
  urlToPageState(hash: string): PageState {
    const params = new URLSearchParams(hash);
    const get = (key: string) => params.get(key) ?? undefined;

    switch (params.get('type')) {
      case 'tracker': {
        const tracker_id = get('tracker');
        return tracker_id === undefined ? { type: 'home' } : { type: 'tracker', tracker_id };
      }
      case 'alert': {
        const alert_id = get('alert');
        return alert_id === undefined ? { type: 'home' } : { type: 'alert', alert_id };
      }
      case 'route': {
        const route_id = get('route');
        if (route_id === undefined) return { type: 'home' };
        const direction_id = get('dir');
        return { type: 'route', route_id, ...(direction_id !== undefined && { direction_id }) };
      }
      case 'stop': {
        const stop_id = get('stop');
        return stop_id === undefined ? { type: 'home' } : { type: 'stop', stop_id };
      }
      case 'trip': {
        const trip_id = get('trip');
        if (trip_id === undefined) return { type: 'home' };
        const route_id = get('route');
        return { type: 'trip', trip_id, ...(route_id !== undefined && { route_id }) };
      }
      default:
        return { type: 'home' };
    }
  }

  /** The full hash for a state, feed params first so links read consistently. */
  buildHash(pageState: PageState): string {
    const params = new URLSearchParams(this.feedParams);
    for (const [k, v] of new URLSearchParams(this.pageStateToURL(pageState))) {
      params.set(k, v);
    }
    return params.toString();
  }

  private writeHash(pageState: PageState): void {
    if (!this.config.enableUrlSync || typeof window === 'undefined') return;

    const hash = this.buildHash(pageState);
    const currentHash = window.location.hash.slice(1);
    if (hash === currentHash) return;

    // Guarded by the equality check above, so the flag can never be left set by
    // a write that produces no hashchange event.
    this.suppressHashUpdate = true;
    window.location.hash = hash;
  }

  /** Back/forward, or a hand-edited address bar. */
  private handleHashChange(): void {
    if (this.suppressHashUpdate) {
      this.suppressHashUpdate = false;
      return;
    }

    let newState = this.urlToPageState(window.location.hash.slice(1));

    if (newState.type !== 'home' && this.stateValidator && !this.stateValidator(newState)) {
      console.warn('[PageStateManager] hashchange: object not in feed, falling back to home');
      newState = { type: 'home' };
    }

    const navigationEvent: NavigationEvent = {
      from: this.currentState,
      to: newState,
      timestamp: Date.now(),
    };
    this.currentState = { ...newState };

    this.recordHistory(navigationEvent);
    this.notify(navigationEvent);
  }

  private recordHistory(event: NavigationEvent): void {
    if (!this.config.enableHistory) return;
    this.navigationHistory.push(event);
    if (this.navigationHistory.length > this.config.maxHistoryLength) {
      this.navigationHistory = this.navigationHistory.slice(-this.config.maxHistoryLength);
    }
  }

  private notify(event: NavigationEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in navigation event handler:', error);
      }
    }
  }
}
