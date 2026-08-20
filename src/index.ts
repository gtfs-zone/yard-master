/**
 * Shell boot: the furniture, the feed session, and the wiring between the map,
 * the panel and the address bar.
 *
 * The panel's contents are phase 5a's (see CURRENT_PLAN.md); until then the
 * panel shows the breadcrumb trail and names the page, which is enough to prove
 * that navigation, hash state and the map focus all agree.
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
import { escHtml } from './modules/render-utils';

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
  // The previous feed's trackers are not this feed's, and phase 7 is what
  // repopulates them from the event stream.
  mapCtrl.clearVehicles();
});

// ─── Focus and selection ──────────────────────────────────────────────────────
const panelContent = document.getElementById('panel-content')!;
const feedSwitcherBtn = document.getElementById('feed-switcher-btn') as HTMLButtonElement;
const reloadBtn = document.getElementById('reload-feed-btn') as HTMLButtonElement;
const accountLink = document.getElementById('account-link') as HTMLAnchorElement;

const appState = new AppState(session, {
  onFeedChange: (feed) => {
    feedSwitcherBtn.textContent = feed ? feed.feed_name : 'Select feed';
    reloadBtn.classList.toggle('hidden', !feed);
    if (!feed) mapCtrl.clearStaticFeed();
  },
  onFocusChange: (state) => {
    renderPanel(state);
    if (state.type === 'home') {
      bottomSheet.close();
    } else {
      bottomSheet.open('half');
    }
    // After the sheet moves, so the camera knows how much of the map is covered.
    mapCtrl.focus(state);
  },
});

// The panel re-renders on any session change so a page that names an object
// which has only just arrived stops showing its bare id.
session.addEventListener('change', () => renderPanel(appState.focus));

/**
 * The placeholder panel. Phase 5a replaces this with the real dispatcher, so it
 * deliberately does no more than prove the trail and the page agree.
 */
function renderPanel(state: PageState): void {
  if (!session.feed) {
    panelContent.innerHTML =
      '<p class="text-base-content/50 text-sm text-center py-8">No feed selected</p>';
    return;
  }

  const trail = appState.breadcrumbs
    .map(
      (crumb) =>
        `<a class="link link-hover" href="${escHtml(appState.hrefFor(crumb.pageState))}">${escHtml(
          crumb.label
        )}</a>`
    )
    .join('<span class="opacity-40 mx-1">/</span>');

  const status = session.staticError
    ? `<p class="text-sm text-error">Static feed did not load: ${escHtml(session.staticError)}</p>`
    : session.staticFeed
      ? `<p class="text-sm opacity-60">${session.staticFeed.stops.size} stops, ${session.staticFeed.routes.size} routes, ${session.trackers.size} trackers.</p>`
      : `<p class="text-sm opacity-60">Downloading the static feed… ${session.trackers.size} trackers.</p>`;

  panelContent.innerHTML = `
    <div class="space-y-3">
      <div class="text-xs opacity-70">${trail || escHtml(session.feed.feed_name)}</div>
      <h2 class="text-lg font-semibold">${escHtml(state.type)}</h2>
      ${status}
      <p class="text-xs opacity-40">This page arrives in phase 5a.</p>
    </div>`;
}

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
    await appState.refreshFeed();
    void session.loadStatic(feed.static_feed_url, feed.feed_name);
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) {
      notify.error(
        `Could not reload ${feed.feed_name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } finally {
    reloadBtn.disabled = false;
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
