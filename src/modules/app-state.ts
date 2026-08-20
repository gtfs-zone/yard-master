/* @vendored-from test-track:src/modules/app-state.ts
   @sha fa12a57
   @status modified
   @changes
   - Selection is a feed row from the API, not a `FeedSelection` of URLs, so
     `feed-url.ts` and `isComplete` are gone and the hash's feed half is one
     `feed=<feed_name>` param. `findFeed` resolves that name against
     `GET /feeds`, falling back to the admin-only server-wide list.
   - `boot()` fetches `/api/me` first, and falls back to the last feed in
     localStorage when the hash names none.
   - `selectFeed()` added: it does not await the static download, because the
     managed half of the app is usable without it and an unreachable
     `static_feed_url` must not make the tree unusable.
   - A pending focus is held rather than resolved once. test-track can decide
     immediately because it awaits the load; here a `route`/`stop`/`trip` link
     cannot resolve until the zip parses, so `applyPendingFocus` runs at each
     stage and only the last one is entitled to call a link dead.
   - `onFeedChange` added to the hooks, and `refreshFeed`/`clearFeed` with it. */
/**
 * The single entry point for selecting a feed and for changing focus.
 *
 * Map click, panel link, hash change, feed switcher and boot restore all
 * converge here, and everything downstream — the panel, the map, the bottom
 * sheet, the address bar — reacts to this module rather than to each other. In
 * particular, only `PageStateManager` ever writes the hash, which is what keeps
 * its `suppressHashUpdate` guard honest.
 *
 * The hash carries the feed by `feed_name` rather than by id, so a link reads
 * like the thing it points at. Resolving a name to a row costs one list
 * request at boot, which the app makes anyway to populate the switcher.
 *
 * Selection and the static download are deliberately separate. A feed is
 * selected the moment its API row is in hand, and its trackers, rules and
 * people are reachable from that instant; the zip lands whenever it lands, or
 * never, if `static_feed_url` is unreachable. Nothing in the managed half is
 * allowed to wait on it.
 */

import { CONFIG } from '../config';
import type { PageState } from '../types/page-state';
import { pageStatesEqual } from '../types/page-state';
import type { Feed, Me } from '../types/api';
import { buildBreadcrumbs, validateState } from './breadcrumbs';
import type { FeedSession } from './feed-session';
import { getFeed, listFeeds, listTrackers, SessionExpiredError } from './api-client';
import { getMe } from './api-client';
import { notify } from './notification-system';
import { PageStateManager } from './page-state-manager';

export interface AppStateHooks {
  /** Called on every focus change, including the boot restore. */
  onFocusChange: (state: PageState) => void;
  /** Called whenever the selected feed changes, including to null. */
  onFeedChange: (feed: Feed | null) => void;
}

export class AppState {
  readonly pages = new PageStateManager({ enableUrlSync: true });
  private session: FeedSession;
  private hooks: AppStateHooks;

  /** The signed-in person. Null until `boot()` has answered. */
  me: Me | null = null;

  /**
   * A focus from a link that has not resolved yet, because the object it names
   * lives in a zip that is still downloading. Cleared once it resolves, or once
   * the load finishes without it.
   */
  private pendingFocus: PageState | null = null;

  constructor(session: FeedSession, hooks: AppStateHooks) {
    this.session = session;
    this.hooks = hooks;

    this.pages.setBreadcrumbBuilder((state) => buildBreadcrumbs(session, state));
    this.pages.setStateValidator((state) => validateState(session, state));
    this.pages.addNavigationHandler((event) => this.hooks.onFocusChange(event.to));

    // The parsed feed is the last thing a linked route/stop/trip was waiting
    // for, and the first thing that can invalidate a focus carried over from
    // the previous feed.
    session.addEventListener('staticloaded', () => this.onStaticLoaded());
  }

  get focus(): PageState {
    return this.pages.getPageState();
  }

  get breadcrumbs() {
    return this.pages.getBreadcrumbs();
  }

  setFocus(state: PageState): void {
    if (pageStatesEqual(state, this.focus)) return;
    this.pages.setPageState(state);
  }

  clearFocus(): void {
    this.setFocus({ type: 'home' });
  }

  /**
   * Boot: find out who is signed in, work out which feed the hash (or the last
   * session) asked for, and select it.
   *
   * A failure to reach `/api/me` is fatal to the whole app rather than to one
   * panel, so it is reported and boot stops. Everything after it is recoverable
   * by picking a feed from the switcher.
   */
  async boot(): Promise<void> {
    const pending = this.pages.pendingStateFromURL();

    try {
      this.me = await getMe();
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      notify.error(`Could not reach the API: ${describe(err)}`);
      this.hooks.onFocusChange(this.focus);
      return;
    }

    const wanted =
      new URLSearchParams(window.location.hash.slice(1)).get('feed') ??
      localStorage.getItem(CONFIG.SELECTED_FEED_KEY);

    const feed = wanted ? await this.findFeed(wanted) : null;
    if (!feed) {
      if (wanted) notify.warning(`No feed named "${wanted}" is available to you.`);
      // No feed means no focus worth restoring: every page but home is scoped
      // to one.
      this.hooks.onFeedChange(null);
      this.hooks.onFocusChange(this.focus);
      return;
    }

    await this.selectFeed(feed, pending);
  }

  /**
   * Resolve a `feed_name` to its row.
   *
   * The personal list first, because that is the one an admin's own feeds are
   * in; the server-wide list only as a fallback, and only for an admin, so a
   * link to somebody else's feed still opens for the people entitled to it.
   */
  private async findFeed(name: string): Promise<Feed | null> {
    try {
      const mine = await listFeeds();
      const found = mine.find((f) => f.feed_name === name);
      if (found || !this.me?.is_admin) return found ?? null;
      const all = await listFeeds(true);
      return all.find((f) => f.feed_name === name) ?? null;
    } catch (err) {
      if (err instanceof SessionExpiredError) return null;
      notify.error(`Could not list your feeds: ${describe(err)}`);
      return null;
    }
  }

  /**
   * Adopt a feed: write it into the hash, fetch its managed objects, and start
   * the static download without waiting for it.
   *
   * `restore` is the focus a link asked for. It is applied as soon as it
   * resolves, which for a managed page is immediately and for a GTFS page is
   * once the zip has parsed.
   */
  async selectFeed(feed: Feed, restore: PageState = { type: 'home' }): Promise<void> {
    this.session.selectFeed(feed);
    localStorage.setItem(CONFIG.SELECTED_FEED_KEY, feed.feed_name);
    // Written before anything is fetched, so the address bar is shareable even
    // if the feed turns out to be unloadable.
    this.pages.setFeedParams({ feed: feed.feed_name });
    this.hooks.onFeedChange(feed);

    this.pendingFocus = restore.type === 'home' ? null : restore;
    this.applyPendingFocus({ reportMiss: false });

    await this.loadManagedObjects(feed);
    this.applyPendingFocus({ reportMiss: false });

    // Not awaited: the tree above is already usable, and a feed whose zip is
    // slow or unreachable must not hold it hostage. `loadStatic` reports its
    // own failure through `session.staticError` rather than throwing.
    void this.session.loadStatic(feed.static_feed_url, feed.feed_name);
  }

  /** Drop the selection entirely and return to the empty state. */
  clearFeed(): void {
    this.session.clear();
    localStorage.removeItem(CONFIG.SELECTED_FEED_KEY);
    this.pendingFocus = null;
    this.pages.setFeedParams({});
    this.hooks.onFeedChange(null);
    this.clearFocus();
  }

  /**
   * The feed's managed objects. Only trackers for now; rules, alerts and people
   * are fetched by the pages that show them in later phases.
   */
  private async loadManagedObjects(feed: Feed): Promise<void> {
    try {
      this.session.setTrackers(await listTrackers(feed.id));
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      notify.error(`Could not load trackers: ${describe(err)}`);
    }
  }

  /** Re-read the selected feed's row, e.g. after asking for a reload. */
  async refreshFeed(): Promise<void> {
    const current = this.session.feed;
    if (!current) return;
    try {
      const feed = await getFeed(current.id);
      this.session.updateFeed(feed);
      this.hooks.onFeedChange(feed);
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      notify.error(`Could not refresh the feed: ${describe(err)}`);
    }
  }

  private onStaticLoaded(): void {
    // A focus carried over from a previous feed almost never names an object in
    // this one, and rendering an object page for something the feed does not
    // describe is worse than going home.
    const current = this.focus;
    if (current.type !== 'home' && !validateState(this.session, current)) {
      this.clearFocus();
    }
    this.applyPendingFocus({ reportMiss: true });
  }

  /**
   * Apply a focus from a link once the session can resolve it, without
   * dispatching navigation history.
   *
   * `reportMiss` is what separates "not loaded yet" from "not in this feed":
   * only the last attempt, after the zip has parsed, is entitled to call a link
   * dead.
   */
  private applyPendingFocus(options: { reportMiss: boolean }): void {
    const pending = this.pendingFocus;
    if (!pending) return;

    if (validateState(this.session, pending)) {
      this.pendingFocus = null;
      this.pages.adoptState(pending);
      // `adoptState` is silent, and the feed params were written around it, so
      // the focus half of the hash has to be put back.
      this.pages.syncHash();
      this.hooks.onFocusChange(this.focus);
      return;
    }

    if (options.reportMiss) {
      this.pendingFocus = null;
      notify.warning(`Nothing in this feed matches the linked ${pending.type}.`);
      this.pages.adoptState({ type: 'home' });
      this.pages.syncHash();
      this.hooks.onFocusChange(this.focus);
    }
  }

  /**
   * The hash a link to `state` should carry. Object pages render real `<a>`
   * elements so middle-click and copy-link-address behave, even though the
   * click itself is intercepted and handled in place.
   */
  hrefFor(state: PageState): string {
    const hash = this.pages.buildHash(state);
    return hash ? `#${hash}` : '#';
  }

  /** The full shareable URL for the current page. */
  shareableUrl(): string {
    const hash = this.pages.buildHash(this.focus);
    return `${window.location.origin}${window.location.pathname}${hash ? `#${hash}` : ''}`;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
