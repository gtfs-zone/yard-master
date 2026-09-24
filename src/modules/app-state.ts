/* @vendored-from test-track:src/modules/app-state.ts
   @sha c24eb5b
   @status modified
   @changes
   - Selection is a feed row from the API, not a `FeedSelection` of URLs, so
     `feed-url.ts` and `isComplete` are gone and the hash's feed half is one
     `feed=<feed_name>` param. `findFeed` resolves that name against
     `GET /feeds`, falling back to the admin-only server-wide list.
   - `boot()` fetches `/api/me` first, and falls back to the last feed in
     localStorage when the hash names none.
   - `selectFeed()` added: it does not await the schedule download, because the
     managed half of the app is usable without it and an unreachable
     `static_feed_url` must not make the tree unusable.
   - Neither half of upstream's boot-modal machinery is taken. `f9d3e2c`'s
     `bootSeed` carried a half-filled `FeedSelection` out of `boot()` so the
     load modal could be seeded with it, and `f1ee0ff` replaced it and `boot()`
     with `bootRequest()` / `finishBoot()` / `bootEmpty()`, moving the load and
     its error reporting to `index.ts` so a failed link can reopen the modal.
     There is no such modal and no `FeedSelection` here — a feed is one of your
     own rows, named in the hash by `feed_name` — so `boot()` stays one call
     that resolves that name and loads it.
   - A pending focus is held rather than resolved once. test-track can decide
     immediately because it awaits the load; here a `route`/`stop`/`trip` link
     cannot resolve until the zip parses, so `applyPendingFocus` runs at each
     stage and only the last one is entitled to call a link dead.
   - `onFeedChange` added to the hooks, and `refreshFeed`/`clearFeed` with it.
   - `emit` is overridden to put `loadPageData` on the focus side of the
     split: opening the guide over a tracker page must not re-fetch the
     tracker any more than it re-renders the panel.
   - `loadPageData` added: a managed page may need an object the list requests
     do not carry (a tracker's `device_key`, an alert's informed entities), so
     every focus change asks for what the page it opened needs.
   - The refreshers are public: a write in `actions.ts` re-reads the list it
     changed rather than patching the session by hand, so the panel can never
     show a row the server did not confirm. `adoptFeedRow` is the same idea for
     the feed itself, and owns the hash rewrite a rename needs.
   - The feed's event stream is owned here, because this is the one module that
     knows when a feed starts and stops being the selected one.
   - The live fleet with it: the bootstrap fetch on selection, the pushed
     fixes, and the sweep that expires a vehicle whose fix has aged out. Only
     this module knows a feed is selected *and* holds a timer. */
/**
 * Feed selection, on top of focus changes.
 *
 * The focus half is `interlocking`'s `FocusController`: map click, panel link,
 * hash change and boot restore all converge on it. What this adds is the feed
 * half of the hash, the boot sequence that resolves it, and the page data each
 * focus change fetches.
 *
 * The hash carries the feed by `feed_name` rather than by id, so a link reads
 * like the thing it points at. Resolving a name to a row costs one list
 * request at boot, which the app makes anyway to populate the switcher.
 *
 * Selection and the schedule download are deliberately separate. A feed is
 * selected the moment its API row is in hand, and its trackers, rules and
 * managers are reachable from that instant; the zip lands whenever it lands, or
 * never, if `static_feed_url` is unreachable. Nothing in the managed half is
 * allowed to wait on it.
 */

import { CONFIG } from '../config';
import type { PageState } from '../types/page-state';
import type { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import type { FocusHooks } from 'interlocking/ui/focus-controller';
import { FocusController } from 'interlocking/ui/focus-controller';
import { homeWithModal, sameLocation } from 'interlocking/ui/page-state-manager';
import type { Feed, LoadStatus, Me } from '../types/api';
import type { VehiclePosition } from '../map-controller';
import { buildBreadcrumbs, validateState } from './breadcrumbs';
import type { FeedSession } from './feed-session';
import {
  getAlert,
  getFeed,
  getMembers,
  getTracker,
  listAlerts,
  listAssignments,
  listFeeds,
  listRules,
  listTrackerPositions,
  listTrackers,
  listUploads,
  SessionExpiredError,
} from './api-client';
import { scheduleFetchUrl } from './feed-source';
import type { ServiceDate } from './service-date';
import { getMe } from './api-client';
import { notify } from 'interlocking/ui/notification-system';
import { createPageStateManager } from './page-state-manager';
import { FeedEventStream } from './event-stream';

export interface AppStateHooks extends FocusHooks<PageState> {
  /** Called whenever the selected feed changes, including to null. */
  onFeedChange: (feed: Feed | null) => void;
}

export class AppState extends FocusController<PageState, BreadcrumbItem<PageState>> {
  protected declare hooks: AppStateHooks;
  private session: FeedSession;

  /** The signed-in person. Null until `boot()` has answered. */
  me: Me | null = null;

  /**
   * A focus from a link that has not resolved yet, because the object it names
   * lives in a zip that is still downloading. Cleared once it resolves, or once
   * the load finishes without it.
   */
  private pendingFocus: PageState | null = null;

  /**
   * Detail requests already in flight, keyed by the page that asked. The panel
   * re-renders on every session event, and a focus can be announced more than
   * once while a feed is being adopted, so without this a slow request would be
   * fired again on each pass.
   */
  private loadingPages = new Set<string>();

  /**
   * The selected feed's live channel. One instance for the app's lifetime; it
   * holds at most one connection and re-points it on every selection.
   */
  private stream = new FeedEventStream({
    onLoad: (feedId, load) => this.applyLoadStatus(feedId, load),
    onPosition: (feedId, vehicle) => this.applyPosition(feedId, vehicle),
  });

  /**
   * The sweep that expires vehicles nobody has heard from. Runs only while a
   * feed is selected: an app sitting on the switcher has no fleet to age.
   */
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Tracker ids a pushed fix named that the list did not have, and which have
   * already cost one re-read. Without it a tracker that stays unknown — because
   * it belongs to a feed the caller cannot see, or was deleted mid-flight —
   * would fire a list request per fix.
   */
  private chasedTrackers = new Set<string>();

  /**
   * The service-date window the calendar last asked to have expanded, so a
   * write from anywhere in the app can re-read exactly what is on screen.
   */
  private assignmentWindow: { from: ServiceDate; to: ServiceDate } | null = null;

  /** The expansion request in flight, so two widenings do not race. */
  private assignmentLoad: Promise<void> | null = null;

  constructor(session: FeedSession, hooks: AppStateHooks) {
    super(createPageStateManager(), hooks);
    this.session = session;

    this.pages.setBreadcrumbBuilder((state) => buildBreadcrumbs(session, state));
    this.pages.setStateValidator((state) => validateState(session, state));

    // The parsed feed is the last thing a linked route/stop/trip was waiting
    // for, and the first thing that can invalidate a focus carried over from
    // the previous feed.
    session.addEventListener('scheduleloaded', () => this.onScheduleLoaded());
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
      this.repaint();
      return;
    }

    const wanted =
      new URLSearchParams(window.location.hash.slice(1)).get('feed') ??
      localStorage.getItem(CONFIG.SELECTED_FEED_KEY);

    const feed = (wanted ? await this.findFeed(wanted) : null) ?? (await this.onlyFeed());
    if (!feed) {
      if (wanted) notify.warning(`No feed named "${wanted}" is available to you.`);
      // No feed means no focus worth restoring: every page but home is scoped
      // to one.
      this.hooks.onFeedChange(null);
      this.repaint();
      return;
    }

    await this.selectFeed(feed, pending);
  }

  /**
   * The feed to open when nothing named one: the only one there is, or null.
   *
   * Somebody with a single feed has no choice to make, so asking them to make
   * it is friction with one answer. Two or more, or none, and the caller opens
   * the switcher instead. A listing failure is not reported here, because the
   * switcher lists again and shows the error in place.
   */
  private async onlyFeed(): Promise<Feed | null> {
    try {
      const mine = await listFeeds();
      return mine.length === 1 ? mine[0] : null;
    } catch {
      return null;
    }
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
   * the schedule download without waiting for it.
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

    // Before the list requests rather than after: the first frame is the
    // current load status, so a feed whose download is already running says so
    // without waiting for three list responses first.
    this.stream.connect(feed.id);
    this.startPruning();
    this.chasedTrackers.clear();

    this.pendingFocus = restore.type === 'home' ? null : restore;
    this.applyPendingFocus({ reportMiss: false });

    await this.loadManagedObjects(feed);
    this.applyPendingFocus({ reportMiss: false });

    // Not awaited: the tree above is already usable, and a feed whose zip is
    // slow or unreachable must not hold it hostage. `loadScheduled` reports its
    // own failure through `session.scheduleError` rather than throwing.
    this.reloadScheduled();
  }

  /**
   * Re-download the selected feed's zip into this browser.
   *
   * Where the zip *is* depends on the feed's source, which is why nothing
   * calls `loadScheduled` with a URL of its own any more. A hosted feed with no
   * upload yet has no zip anywhere, and saying so is better than a progress
   * bar that never moves.
   */
  reloadScheduled(): void {
    const feed = this.session.feed;
    if (!feed) return;
    const url = scheduleFetchUrl(feed);
    if (!url) {
      this.session.noScheduled('This feed has no schedule yet. Upload a zip to give it one.');
      return;
    }
    void this.session.loadScheduled(url, feed.feed_name);
  }

  /**
   * Replace the selected feed's row after a write to it.
   *
   * `feed_name` is what the hash carries, so a rename has to rewrite the hash;
   * leaving it would point a shareable link at a name that no longer resolves.
   * A renamed *tracker* needs none of this, which is what the surrogate key
   * bought: the hash holds an id nothing about a rename touches.
   */
  adoptFeedRow(feed: Feed): void {
    this.session.updateFeed(feed);
    localStorage.setItem(CONFIG.SELECTED_FEED_KEY, feed.feed_name);
    this.pages.setFeedParams({ feed: feed.feed_name });
    this.hooks.onFeedChange(feed);
  }

  /** Re-read the trackers, e.g. after creating, renaming or deleting one. */
  async refreshTrackers(): Promise<void> {
    const feed = this.session.feed;
    if (!feed) return;
    await this.fetchInto('trackers', () => listTrackers(feed.id), (rows) =>
      this.session.setTrackers(rows)
    );
  }

  /** Re-read the managed alerts. */
  async refreshServiceAlerts(): Promise<void> {
    const feed = this.session.feed;
    if (!feed) return;
    await this.fetchInto('service alerts', () => listAlerts(feed.id), (rows) =>
      this.session.setServiceAlerts(rows)
    );
  }

  /** Re-read the members and open invites. */
  async refreshMembers(): Promise<void> {
    const feed = this.session.feed;
    if (!feed) return;
    await this.fetchInto('members', () => getMembers(feed.id), (members) =>
      this.session.setMembers(members)
    );
  }

  /**
   * Re-read the feed's upload history.
   *
   * Only a hosted feed has one, but the request is made either way when it is
   * asked for: a feed that was hosted an hour ago and is linked now still has
   * the uploads it had, and hiding them would hide the way back.
   */
  async refreshUploads(): Promise<void> {
    const feed = this.session.feed;
    if (!feed) return;
    try {
      this.session.setUploads(await listUploads(feed.id));
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      this.session.failedUploads();
      notify.error(`Could not load uploads: ${describe(err)}`);
    }
  }

  /** Re-read the feed's assignment rules. */
  async refreshRules(): Promise<void> {
    const feed = this.session.feed;
    if (!feed) return;
    await this.fetchInto('assignment rules', () => listRules(feed.id), (rows) =>
      this.session.setRules(rows)
    );
  }

  /** Expand the rules over one window, which is what the week charts draw. */
  async refreshAssignments(from: ServiceDate, to: ServiceDate): Promise<void> {
    const feed = this.session.feed;
    if (!feed) return;
    this.assignmentWindow = { from, to };
    await this.fetchInto('assignments', () => listAssignments(feed.id, from, to), (rows) =>
      this.session.setAssignments(from, to, rows)
    );
  }

  /**
   * Make sure a window is expanded, widening the held one rather than replacing
   * it.
   *
   * The calendar modal asks for whatever month it is showing while the navbar
   * badge is holding this week, and a narrower window would leave the badge
   * counting nothing with no request out to fill it. Widening keeps both
   * covered; selecting another feed is what drops the window again.
   */
  async ensureAssignments(from: ServiceDate, to: ServiceDate): Promise<void> {
    // A request already out lands first, so its window is the one this widens.
    await this.assignmentLoad;
    const held = this.assignmentWindow;
    if (held && held.from <= from && held.to >= to) return;

    const wanted = {
      from: held && held.from < from ? held.from : from,
      to: held && held.to > to ? held.to : to,
    };
    this.assignmentLoad = this.refreshAssignments(wanted.from, wanted.to).finally(() => {
      this.assignmentLoad = null;
    });
    await this.assignmentLoad;
  }

  /**
   * Re-read both halves of the calendar after a write.
   *
   * The rules are what an editor reads and the expansion is what the grid
   * draws, and a write to one changes the other: adding an exception changes
   * no rule field and moves a day off the calendar. The window is the one last
   * asked for, so a write made from a trip page refreshes whichever weeks the
   * calendar was left on.
   */
  async refreshCalendar(): Promise<void> {
    const window = this.assignmentWindow;
    await Promise.all([
      this.refreshRules(),
      window ? this.refreshAssignments(window.from, window.to) : Promise.resolve(),
    ]);
  }

  /** Re-read the whole live fleet. The pushed fixes keep it current after. */
  async refreshPositions(): Promise<void> {
    const feed = this.session.feed;
    if (!feed) return;
    await this.fetchInto('tracker positions', () => listTrackerPositions(feed.id), (rows) =>
      this.session.setVehicles(rows)
    );
  }

  /** Drop the selection entirely and return to the empty state. */
  clearFeed(): void {
    this.stream.close();
    this.stopPruning();
    this.chasedTrackers.clear();
    this.assignmentWindow = null;
    this.session.clear();
    localStorage.removeItem(CONFIG.SELECTED_FEED_KEY);
    this.pendingFocus = null;
    this.pages.setFeedParams({});
    this.hooks.onFeedChange(null);
    this.clearFocus();
  }

  /**
   * The feed's managed objects: everything the feed page counts.
   *
   * All three in parallel and all three eagerly, because the tree shows a count
   * for each and a count that arrives one page visit later is worse than three
   * small requests on selection. Rules are not here: they belong to the
   * calendar, which asks for a date range rather than for everything.
   *
   * One failing does not take the others down — a member who may read the feed
   * but not its managers should still get their trackers.
   */
  private async loadManagedObjects(feed: Feed): Promise<void> {
    await Promise.all([
      this.fetchInto('trackers', () => listTrackers(feed.id), (rows) =>
        this.session.setTrackers(rows)
      ),
      this.fetchInto('service alerts', () => listAlerts(feed.id), (rows) =>
        this.session.setServiceAlerts(rows)
      ),
      this.fetchInto('members', () => getMembers(feed.id), (members) =>
        this.session.setMembers(members)
      ),
      // The fleet as it stands, so the map is populated before the first fix
      // is pushed. A tracker reporting once a minute would otherwise leave the
      // map empty for most of that minute.
      this.fetchInto('tracker positions', () => listTrackerPositions(feed.id), (rows) =>
        this.session.setVehicles(rows)
      ),
    ]);
  }

  /** One list request, reported by name and never allowed to throw at a caller. */
  private async fetchInto<T>(
    what: string,
    fetch: () => Promise<T>,
    apply: (value: T) => void
  ): Promise<void> {
    try {
      apply(await fetch());
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      notify.error(`Could not load ${what}: ${describe(err)}`);
    }
  }

  /**
   * Whatever the page just opened needs and the list requests did not carry.
   *
   * A tracker's `device_key` and an alert's informed entities are served by the
   * detail endpoints alone, so they are fetched on arrival rather than for
   * every row of a list. The result goes into the session, which re-renders the
   * panel; nothing here returns anything to the caller.
   */
  private async loadPageData(state: PageState): Promise<void> {
    const key = JSON.stringify(state);
    if (this.loadingPages.has(key)) return;

    const session = this.session;
    let load: (() => Promise<void>) | null = null;

    if (state.type === 'tracker') {
      // The credential, and the rules the page lists. The feed's whole rule set
      // rather than this tracker's: it is one small request, the calendar and
      // the trip pages want the same rows, and the session holds one copy.
      const needsDetail = !session.trackerDetails.has(state.tracker_id);
      const needsRules = !session.rules;
      if (needsDetail || needsRules) {
        load = async () => {
          await Promise.all([
            needsDetail
              ? getTracker(state.tracker_id).then((d) => session.setTrackerDetail(d))
              : Promise.resolve(),
            needsRules ? this.refreshRules() : Promise.resolve(),
          ]);
        };
      }
    } else if (state.type === 'trip' && !session.rules) {
      // The trip page lists what is assigned to it, and an empty rule map
      // would otherwise read as "nothing is".
      load = async () => this.refreshRules();
    } else if (state.type === 'alert' && !session.alertDetails.has(state.alert_id)) {
      // The id is the managed row's, so it goes back to a number here and
      // nowhere else: everything above this line keys alerts by string.
      const id = Number(state.alert_id);
      if (Number.isFinite(id)) load = async () => session.setAlertDetail(await getAlert(id));
    } else if (state.type === 'home' && session.feed) {
      // A feed linked now may still have upload history from when it was
      // hosted, so this is asked for regardless of the current source kind.
      const feed = session.feed;
      const needsUploads = session.uploads === undefined;
      // Sharing is a modal over whatever page is open, so its rows are fetched
      // with the feed rather than on the way in: opening it should not be a
      // round trip.
      const needsMembers = !session.members;
      // The feed page's assignment counts need the whole rule set too, or
      // they read zero on first paint instead of "—".
      const needsRules = !session.rules;
      if (needsUploads || needsMembers || needsRules) {
        load = async () => {
          await Promise.all([
            needsUploads ? this.refreshUploads() : Promise.resolve(),
            needsMembers
              ? getMembers(feed.id).then((m) => session.setMembers(m))
              : Promise.resolve(),
            needsRules ? this.refreshRules() : Promise.resolve(),
          ]);
        };
      }
    }
    if (!load) return;

    this.loadingPages.add(key);
    try {
      await load();
    } catch (err) {
      if (!(err instanceof SessionExpiredError)) {
        notify.error(`Could not load this ${state.type}: ${describe(err)}`);
      }
    } finally {
      this.loadingPages.delete(key);
    }
  }

  /**
   * Fan a state out to the hooks, fetching what its page needs.
   *
   * Every path that changes the state goes through here — the navigation
   * handler, the boot restore and the pending-focus resolver — so a page can
   * never be shown without the request that fills it having been made. The
   * fetch sits on the focus side of the split, so opening the guide over a
   * tracker page does not re-read the tracker.
   */
  protected override emit(to: PageState, from?: PageState): void {
    if (!from || !sameLocation(from, to)) {
      void this.loadPageData(to);
    }
    super.emit(to, from);
  }

  /**
   * Apply a load status pushed down the channel.
   *
   * `feedId` is checked rather than trusted: a feed switch can land between an
   * event being published and being delivered, and writing the old feed's
   * status onto the new one is a lie with nothing to give it away.
   *
   * The transition is reported, not the state. The first frame of every stream
   * carries the current status, which is almost always the one the feed row
   * already had, so announcing every frame would toast on each connect. Only
   * `success` and `failed` are announced at all: they are where a load stops,
   * and the badge is already saying `running` in the meantime.
   */
  private applyLoadStatus(feedId: number, load: LoadStatus | null): void {
    const feed = this.session.feed;
    if (!feed || feed.id !== feedId) return;

    const before = feed.load?.status ?? null;
    this.session.setLoadStatus(load);
    const after = load?.status ?? null;
    if (after === before) return;

    if (after === 'success') {
      notify.success(`${feed.feed_name}: the server finished loading the schedule.`);
    } else if (after === 'failed') {
      notify.error(`${feed.feed_name}: the server could not load the schedule.`);
    }
  }

  /**
   * Apply a fix pushed down the channel.
   *
   * Scoped to the current feed for the same reason a load status is: a switch
   * can land between the publish and the delivery, and another feed's tracker
   * appearing on this feed's map is a lie with nothing to give it away.
   */
  private applyPosition(feedId: number, vehicle: VehiclePosition): void {
    const feed = this.session.feed;
    if (!feed || feed.id !== feedId) return;
    this.session.applyVehicle(vehicle);

    // A fix from a tracker this app has not listed means the list is out of
    // date: somebody created a tracker in another session, or in another tab.
    // The vehicle is drawn either way — it is a real thing in a real place —
    // but without the row it has no nickname and no page to click into, so the
    // list is re-read once per unknown id rather than left to be noticed.
    if (this.session.trackers.has(vehicle.trackerId)) return;
    if (this.chasedTrackers.has(vehicle.trackerId)) return;
    this.chasedTrackers.add(vehicle.trackerId);
    void this.refreshTrackers();
  }

  private startPruning(): void {
    this.stopPruning();
    this.pruneTimer = setInterval(
      () => this.session.pruneVehicles(),
      CONFIG.TRACKER_PRUNE_MS
    );
  }

  private stopPruning(): void {
    if (this.pruneTimer !== null) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
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

  private onScheduleLoaded(): void {
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
      this.repaint();
      return;
    }

    if (options.reportMiss) {
      this.pendingFocus = null;
      notify.warning(`Nothing in this feed matches the linked ${pending.type}.`);
      // The modal outlives the page it was linked over: it names no object.
      this.pages.adoptState(homeWithModal(pending));
      this.pages.syncHash();
      this.repaint();
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
