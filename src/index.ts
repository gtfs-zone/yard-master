/**
 * Shell boot: the furniture, the feed session, and the wiring between the map,
 * the panel and the address bar.
 *
 * The panel itself is `PanelRenderer`, which owns its own re-rendering off the
 * session's events. Everything here does is tell it which page to show.
 */
import { MapController } from './map-controller';
import type { GTFSStatic } from './gtfs-static';
import type { PageState } from './types/page-state';
import { notify } from './modules/notification-system';
import { PanelResizer, restorePanelWidth } from './modules/panel-resizer';
import { BottomSheetController } from './modules/bottom-sheet';
import { ThemeController } from './modules/theme-controller';
import { FeedSession } from './modules/feed-session';
import { AppState } from './modules/app-state';
import { showFeedSwitcher } from './modules/feed-switcher';
import { reloadFeed, SessionExpiredError } from './modules/api-client';
import { SearchController } from './modules/search-controller';
import { buildSearchEntries } from './modules/search-entries';
import { PanelRenderer } from './modules/panel-renderer';
import { Actions } from './modules/actions';
import { isServiceDate } from './modules/service-date';

// ─── Shell ────────────────────────────────────────────────────────────────────
const version = document.getElementById('app-version');
if (version) version.textContent = __APP_VERSION__;

const appContainer = document.querySelector<HTMLElement>('.app-container')!;
restorePanelWidth(appContainer);

notify.initialize();

const themeController = new ThemeController();
themeController.initialize();

const mapCtrl = new MapController();
mapCtrl.initialize('map');
// The map accent is resolved from the daisyUI palette, so it has to be
// repainted whenever the theme switches; `refreshAccentColor` clears the
// per-token cache in `theme-color.ts` on the way through.
themeController.onThemeChange(() => mapCtrl.refreshAccentColor());

new PanelResizer(appContainer, mapCtrl);

const rightPanel = document.getElementById('right-panel')!;
const bottomSheet = new BottomSheetController(rightPanel);
// On mobile the sheet sits over the map, so the camera has to hold a focused
// feature above it rather than centring it under the sheet.
bottomSheet.onSnapChange((covered) => mapCtrl.setBottomPadding(covered));

// ─── Feed session ─────────────────────────────────────────────────────────────
const session = new FeedSession();

session.addEventListener('staticloaded', (e) => {
  // `loadStaticFeed` replaces the previous feed's data in place; an explicit
  // clear would only cost an extra empty repaint.
  mapCtrl.loadStaticFeed((e as CustomEvent<GTFSStatic>).detail);
  // The vehicles are pushed back rather than cleared: a fleet can arrive long
  // before a slow zip does, and clearing here would blank a map that was
  // already right. Repainting also re-colors every dot, since which route a
  // vehicle is on only becomes knowable once the schedule has parsed.
  showVehicles();
});

// The live fleet, from the bootstrap fetch and from every fix pushed after it.
// Its own event rather than `change`, which fires for each managed list and
// each detail fetch as well; the map only ever cares about this one.
function showVehicles(): void {
  mapCtrl.showVehicles([...session.vehicles.values()]);
}

session.addEventListener('vehicles', showVehicles);

// ─── Focus and selection ──────────────────────────────────────────────────────
const panelContent = document.getElementById('panel-content')!;
const feedSwitcherBtn = document.getElementById('feed-switcher-btn') as HTMLButtonElement;
const reloadBtn = document.getElementById('reload-feed-btn') as HTMLButtonElement;
const accountLink = document.getElementById('account-link') as HTMLAnchorElement;

// Declared before AppState so the focus hook can name it; the hooks on both
// sides are only ever called after this block has run.
let panel: PanelRenderer;

/**
 * The reload button's two states.
 *
 * Hidden without a feed, and disabled while cafe-car's own load is running,
 * which the event stream reports as it happens. Queueing a second load on top
 * of one already in flight does nothing — schedule-foamer's task is a singleton
 * per feed — so a button that offered it would be lying about what it does.
 */
function syncReloadButton(): void {
  const feed = session.feed;
  reloadBtn.classList.toggle('hidden', !feed);
  const running = feed?.load?.status === 'running';
  reloadBtn.disabled = running;
  reloadBtn.textContent = running ? 'Reloading…' : 'Reload';
}

session.addEventListener('change', syncReloadButton);

const appState = new AppState(session, {
  onFeedChange: (feed) => {
    feedSwitcherBtn.textContent = feed ? feed.feed_name : 'Select feed';
    syncReloadButton();
    if (!feed) {
      mapCtrl.clearStaticFeed();
      mapCtrl.clearVehicles();
    }
    // Selecting a feed is what gives the sheet something to show; dropping one
    // takes it away again.
    if (feed) bottomSheet.open('half');
    else bottomSheet.close();
  },
  onFocusChange: (state) => {
    panel.show(state, appState.breadcrumbs);
    // The sheet stays open on `home`, because `home` is the browse tree and it
    // is the only way into an object with no map feature to tap. A closed
    // sheet hides its own drag handle, so closing it here would strand a phone
    // with no way back to the tree.
    if (session.feed) bottomSheet.open('half');
    else bottomSheet.close();
    // After the sheet moves, so the camera knows how much of the map is covered.
    mapCtrl.focus(state);
    // After `focus`, which clears whatever the previous page drew.
    syncAssignedTrips(state);
  },
});

/**
 * Draw the trips assigned on the selected calendar day.
 *
 * The map has no notion of an assignment, so this is the one place the two are
 * joined: a day in the hash becomes a set of trip ids, and the map draws their
 * geometry the same way it draws one focused trip. Re-run when the expansion
 * arrives, since the focus almost always changes before the request answers.
 */
function syncAssignedTrips(state: PageState): void {
  if (state.type !== 'assignments' || !isServiceDate(state.date)) {
    mapCtrl.showTrips([]);
    return;
  }
  const trips = session.assignmentsOn(state.date).map((a) => a.trip_id);
  mapCtrl.showTrips([...new Set(trips)]);
}

session.addEventListener('assignments', () => syncAssignedTrips(appState.focus));

// Every write the panel can start. Declared here rather than inside the hooks
// so the same instance answers every button, whichever page emitted it.
const actions = new Actions(appState, session);

panel = new PanelRenderer(panelContent, session, {
  navigate: (state) => appState.setFocus(state),
  href: (state) => appState.hrefFor(state),
  hoverStop: (stop_id) => mapCtrl.hoverStop(stop_id),
  meUserId: () => appState.me?.user_id ?? null,
  action: (action, arg) => void actions.run(action, arg),
  mapIssues: () => mapCtrl.issues,
});
panel.initialize();
// The trail is rebuilt from the session, so a crumb whose object only just
// arrived stops showing its bare id. The page itself re-renders on the same
// event, inside the renderer.
session.addEventListener('change', () => panel.setBreadcrumbs(appState.breadcrumbs));
panel.show(appState.focus, appState.breadcrumbs);

// Clicking a stop, route or tracker on the map focuses it in the panel; the
// reverse direction runs through onFocusChange above.
mapCtrl.onSelect = (state) => appState.setFocus(state);
// A click that hits no feature returns to home, clearing the spotlight, hiding
// the panel and closing the bottom sheet, all through onFocusChange.
mapCtrl.onEmptySelect = () => appState.clearFocus();

// ─── Map search ───────────────────────────────────────────────────────────────
// Selecting a result is the same event as clicking the object on the map.
new SearchController<PageState>({
  getEntries: () => buildSearchEntries(session),
  onSelect: (state) => appState.setFocus(state),
}).initialize();

// ─── Feed switcher ────────────────────────────────────────────────────────────
feedSwitcherBtn.addEventListener('click', async () => {
  const feed = await showFeedSwitcher({
    selected: session.feed,
    isAdmin: appState.me?.is_admin ?? false,
  });
  if (feed) await appState.selectFeed(feed);
});

// ─── Reload ───────────────────────────────────────────────────────────────────
// Two halves, deliberately: cafe-car re-downloads the zip for the schedule
// pipeline, and this browser re-downloads it for the map. Neither is the other.
reloadBtn.addEventListener('click', async () => {
  const feed = session.feed;
  if (!feed) return;
  reloadBtn.disabled = true;
  try {
    await reloadFeed(feed.id);
    notify.info(`Queued a reload of ${feed.feed_name}`);
    // The stream reports the load moving to `running` a moment from now, but
    // only once schedule-foamer picks the task up; re-reading the row keeps the
    // gap from looking like nothing happened.
    await appState.refreshFeed();
    void session.loadStatic(feed.static_feed_url, feed.feed_name);
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) {
      notify.error(
        `Could not reload ${feed.feed_name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } finally {
    // Not unconditionally re-enabled: the load this just queued may already be
    // running, and that is what decides the button now.
    syncReloadButton();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
void appState.boot().then(() => {
  // Keycloak's Account Console is where somebody links another login provider.
  // A deployment without one has no page to send them to, so the link goes away
  // rather than 404ing.
  const url = appState.me?.account_url;
  if (url) {
    accountLink.href = url;
    accountLink.classList.remove('hidden');
  } else {
    accountLink.classList.add('hidden');
  }
});
