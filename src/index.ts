/**
 * Shell boot: the furniture, the feed session, and the wiring between the map,
 * the panel and the address bar.
 *
 * The panel itself is `PanelRenderer`, which owns its own re-rendering off the
 * session's events. Everything here does is tell it which page to show.
 */
import { MapController } from './map-controller';
import type { GTFSScheduled } from './gtfs-scheduled';
import type { PageState } from './types/page-state';
import { notify } from './modules/notification-system';
import { PanelResizer, restorePanelWidth } from './modules/panel-resizer';
import { BottomSheetController } from './modules/bottom-sheet';
import { ThemeController } from './modules/theme-controller';
import { FeedSession } from './modules/feed-session';
import { AppState } from './modules/app-state';
import { showFeedSwitcher } from './modules/feed-switcher';
import { SearchController } from './modules/search-controller';
import { buildSearchEntries } from './modules/search-entries';
import { PanelRenderer } from './modules/panel-renderer';
import { Actions } from './modules/actions';
import { addDays, startOfWeek, today } from './modules/service-date';
import { initFieldTooltipPortal } from './utils/tooltip-position';
import { showHelpModal } from './modules/help-modal';
import { setHelpRuntimeData } from './modules/help-pages';
import { calendarBadgeCount, showCalendarModal } from './modules/calendar-modal';
import { alertsBadgeCount, showAlertsModal } from './modules/alerts-modal';
import { showShareModal } from './modules/share-modal';
import { personLabel } from './modules/managed-render';
import { renderNavbarActions } from './modules/navbar-actions';

// ─── Shell ────────────────────────────────────────────────────────────────────
// The navbar's action row is data, not markup. It has to be rendered before
// anything below looks a control up by id.
renderNavbarActions(document.getElementById('navbar-actions')!);

const version = document.getElementById('app-version');
if (version) version.textContent = __APP_VERSION__;

setHelpRuntimeData({ version: __APP_VERSION__ });
document
  .getElementById('about-btn')
  ?.addEventListener('click', () => void showHelpModal('about'));

const appContainer = document.querySelector<HTMLElement>('.app-container')!;
restorePanelWidth(appContainer);

notify.initialize();

// The spec tooltips on every form label. Delegated at the document, so it is
// registered once here rather than per modal.
initFieldTooltipPortal();

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

session.addEventListener('scheduleloaded', (e) => {
  // `loadScheduledFeed` replaces the previous feed's data in place; an explicit
  // clear would only cost an extra empty repaint.
  mapCtrl.loadScheduledFeed((e as CustomEvent<GTFSScheduled>).detail);
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
const feedSwitcherLabel = document.getElementById('feed-switcher-label')!;
const userBtn = document.getElementById('user-btn') as HTMLAnchorElement;

// Declared before AppState so the focus hook can name it; the hooks on both
// sides are only ever called after this block has run.
let panel: PanelRenderer;

const appState = new AppState(session, {
  onFeedChange: (feed) => {
    feedSwitcherLabel.textContent = feed ? feed.feed_name : 'Select feed';
    if (!feed) {
      mapCtrl.clearScheduledFeed();
      mapCtrl.clearVehicles();
    }
    // Selecting a feed is what gives the sheet something to show; dropping one
    // takes it away again.
    if (feed) bottomSheet.open('half');
    else bottomSheet.close();
    // This week, so the calendar button can say how much is running today
    // before anybody opens it.
    if (feed) {
      const weekStart = startOfWeek(today());
      void appState.ensureAssignments(weekStart, addDays(weekStart, 6));
    }
    syncCalendarBadge();
    syncAlertsBadge();
  },
  onFocusChange: (state) => {
    panel.show(state, appState.breadcrumbs);
    // The sheet stays open on `home`, because `home` is the feed page and it
    // is the only way into an object with no map feature to tap. A closed
    // sheet hides its own drag handle, so closing it here would strand a phone
    // with no way back to the feed.
    if (session.feed) bottomSheet.open('half');
    else bottomSheet.close();
    // After the sheet moves, so the camera knows how much of the map is covered.
    mapCtrl.focus(state);
  },
});

// Every write the panel can start. Declared here rather than inside the hooks
// so the same instance answers every button, whichever page emitted it.
const actions = new Actions(appState, session);

panel = new PanelRenderer(panelContent, session, {
  navigate: (state) => appState.setFocus(state),
  href: (state) => appState.hrefFor(state),
  hoverStop: (stop_id) => mapCtrl.hoverStop(stop_id),
  meUserId: () => appState.me?.user_id ?? null,
  action: (action, arg) => void actions.run(action, arg),
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
async function openFeedSwitcher(): Promise<void> {
  const feed = await showFeedSwitcher({
    selected: session.feed,
    isAdmin: appState.me?.is_admin ?? false,
  });
  if (feed) await appState.selectFeed(feed);
}

feedSwitcherBtn.addEventListener('click', () => void openFeedSwitcher());

// ─── Calendar ─────────────────────────────────────────────────────────────────
// Off the navbar rather than the panel, so it opens over whatever page the
// reader is on. It navigates through the same `setFocus` the map and the panel
// use, after closing itself.
const calendarCount = document.getElementById('calendar-count')!;

document.getElementById('calendar-btn')?.addEventListener('click', () => {
  void showCalendarModal({
    ctx: { session, href: (state) => appState.hrefFor(state) },
    navigate: (state) => appState.setFocus(state),
    ensureAssignments: (from, to) => appState.ensureAssignments(from, to),
    ensureRules: () => (session.rules ? Promise.resolve() : appState.refreshRules()),
  });
});

/** The badge: today's assignments, hidden while there are none to count. */
function syncCalendarBadge(): void {
  const count = calendarBadgeCount(session);
  calendarCount.textContent = count === null ? '' : String(count);
  calendarCount.classList.toggle('hidden', !count);
}

session.addEventListener('assignments', syncCalendarBadge);
session.addEventListener('change', syncCalendarBadge);

// ─── Share ────────────────────────────────────────────────────────────────────
// Who manages this feed. A fact about the feed rather than an object to browse
// into, so it is a modal over whatever page is open.
document.getElementById('share-btn')?.addEventListener('click', () => {
  void showShareModal({
    ctx: { session, href: (state) => appState.hrefFor(state) },
    meUserId: () => appState.me?.user_id ?? null,
    action: (action, arg) => void actions.run(action, arg),
  });
});

// ─── Alerts ───────────────────────────────────────────────────────────────────
// The flat list of managed alerts, and the way to write another one. Each row
// navigates into the panel, after closing.
const alertsBadge = document.getElementById('alerts-badge')!;

document.getElementById('alerts-btn')?.addEventListener('click', () => {
  void showAlertsModal({
    ctx: { session, href: (state) => appState.hrefFor(state) },
    navigate: (state) => appState.setFocus(state),
    action: (action, arg) => void actions.run(action, arg),
  });
});

/** The badge: the feed's managed alerts, hidden while there are none. */
function syncAlertsBadge(): void {
  const count = alertsBadgeCount(session);
  alertsBadge.textContent = count ? String(count) : '';
  alertsBadge.classList.toggle('hidden', !count);
}

session.addEventListener('change', syncAlertsBadge);


// ─── Boot ─────────────────────────────────────────────────────────────────────
void appState.boot().then(() => {
  // Keycloak's Account Console is where somebody links another login provider.
  // A deployment without one has no page to send them to, so the link goes away
  // rather than 404ing.
  const me = appState.me;
  const url = me?.account_url;
  if (me && url) {
    // Their own name, or the address they signed in with. `personLabel`'s last
    // resort is the surrogate user id, which says nothing to the person
    // reading it, so the navbar falls back to the generic word instead.
    const label = me.display_name || me.email ? personLabel(me) : 'Account';
    userBtn.textContent = label;
    userBtn.setAttribute('aria-label', label);
    userBtn.href = url;
    userBtn.classList.remove('hidden');
  } else {
    userBtn.classList.add('hidden');
  }

  // Landing on no feed leaves an empty map with nothing on it to act on, so the
  // switcher opens itself: it lists the feeds worth picking, and offers the new
  // feed form when there are none. Only when boot actually reached the API,
  // because a failed boot has already said so and a modal would bury it.
  if (appState.me && !session.feed) void openFeedSwitcher();
});
