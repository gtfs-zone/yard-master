/* @vendored-from test-track:src/modules/panel-renderer.ts
   @sha c24eb5b
   @status modified
   @changes
   - The session events are yard-master's: `change`, `vehicles`, `assignments`
     and `scheduleloaded` replace test-track's `vehicles` / `tripUpdates` /
     `alerts`.
   - No `active` flag and no `hide()`. test-track hands the panel back to a
     status page when nothing is focused; here `home` is the feed itself, so
     the panel always has something to render.
   - `setBreadcrumbs` passed through to `PanelHost`: the trail is rebuilt
     outside this class and can arrive after the page it belongs to, without a
     scroll reset.
   - The dispatcher covers yard-master's seven variants: `home` renders the
     feed itself, `trip` and `vehicle` are this repo's own pages (`vehicle`
     being one vehicle of a tracker that carries several), and `tracker` and
     `alert` render the managed objects. There are no list pages; a list is
     a scrollbox on the page of the object that owns it.
   - `meUserId` added to the hooks: sharing marks the signed-in row, and
     `RenderContext` is a verbatim type that has no business growing a field
     for it.
   - `action` added to the hooks and handed to `PanelHost`, which delegates
     `data-action` alongside `data-nav`. test-track's panel is read-only and
     passes none; here a page emits a button and `actions.ts` owns what it
     does, which is what keeps the pages pure string renderers.
   - The feed page takes no map-issue counts. Upstream reads them off its own
     status page; here the map draws what it could draw and the feed page is
     the feed, not a report on it. */
/**
 * The right panel's object pages: one dispatcher over `PageState`.
 *
 * The host, meaning the breadcrumb header, the `data-nav` and `data-action`
 * delegation, and the scroll and `<details>` restore around each re-render, is
 * `interlocking`'s `PanelHost`. What this adds is the session events that
 * trigger a re-render, the realtime index the pages read, the live relative
 * times, and the route-strip hover.
 */

import type { PageState } from '../types/page-state';
import type { BreadcrumbItem } from 'interlocking/ui/breadcrumb-trail';
import { PanelHost } from 'interlocking/ui/panel-host';
import type { FeedSession } from './feed-session';
import { RtIndex as LiveRtIndex } from 'interlocking/gtfs/rt-index';
import type { RenderContext, RtIndex } from './render-context';
import { formatRelative } from 'interlocking/gtfs/entity-render';
import { renderAlertPage } from './pages/alert-page';
import { renderRoutePage } from './pages/route-page';
import { renderStopPage } from './pages/stop-page';
import { renderTrackerPage } from './pages/tracker-page';
import { renderVehiclePage } from './pages/vehicle-page';
import { renderFeedPage } from './pages/feed-page';
import { renderTripPage } from './pages/trip-page';

export interface PanelRendererHooks {
  /** Navigate to a page, as if the user had clicked it on the map. */
  navigate: (state: PageState) => void;
  /** The full hash for a page, so links are real links. */
  href: (state: PageState) => string;
  /** Light a stop on the map while its route-strip row is hovered. */
  hoverStop: (stop_id: string | null) => void;
  /** The signed-in user's id, or null before `/me` has answered. */
  meUserId: () => number | null;
  /** Run a write, named by the button that asked for it. */
  action: (action: string, arg: string) => void;
}

export class PanelRenderer {
  private host: HTMLElement;
  private session: FeedSession;
  private hooks: PanelRendererHooks;
  private panel: PanelHost<PageState>;

  private hoveredStopId: string | null = null;

  /** Invalidated on every payload event; rebuilt lazily on the next render. */
  private index: RtIndex | null = null;

  constructor(host: HTMLElement, session: FeedSession, hooks: PanelRendererHooks) {
    this.host = host;
    this.session = session;
    this.hooks = hooks;
    this.panel = new PanelHost<PageState>(host, {
      navigate: hooks.navigate,
      href: hooks.href,
      renderPage: state => this.renderPage(state),
      action: hooks.action,
      tick: el => {
        el.querySelectorAll<HTMLElement>('[data-since]').forEach(since => {
          since.textContent = formatRelative(Number(since.dataset.since));
        });
      },
    });
  }

  initialize(): void {
    // `change` covers every managed update, `vehicles` the live fleet,
    // `assignments` an expanded calendar window and `scheduleloaded` the parsed
    // zip. All four invalidate the index, since any of them can change what a
    // page can resolve. `vehicles` is separate from `change` because it fires
    // per pushed fix, which the map wants and most of the rest of the app does
    // not.
    for (const event of ['change', 'vehicles', 'assignments', 'scheduleloaded'] as const) {
      this.session.addEventListener(event, () => {
        this.index = null;
        this.panel.queueRender();
      });
    }

    this.panel.initialize();
    // pointerover/out bubble, unlike pointerenter/leave, so they can be
    // delegated to the panel host and survive every re-render.
    this.host.addEventListener('pointerover', e => this.onPointerOver(e));
    this.host.addEventListener('pointerout', e => this.onPointerOut(e));
  }

  destroy(): void {
    this.panel.destroy();
  }

  /**
   * Replace the trail without changing the page. The trail is rebuilt from the
   * session, so it goes stale whenever an object a crumb names arrives late;
   * this keeps the reader's scroll position, which `show` deliberately does not.
   */
  setBreadcrumbs(breadcrumbs: BreadcrumbItem<PageState>[]): void {
    this.panel.setBreadcrumbs(breadcrumbs);
  }

  /** Render `state`. `home` is the feed itself, so there is always a page. */
  show(state: PageState, breadcrumbs: BreadcrumbItem<PageState>[]): void {
    this.clearHoveredStop();
    this.panel.show(state, breadcrumbs);
  }

  /**
   * Drop the hover light. A page change replaces the rows under the pointer,
   * so the `pointerout` that would normally clear it never arrives.
   */
  private clearHoveredStop(): void {
    if (this.hoveredStopId === null) return;
    this.hoveredStopId = null;
    this.hooks.hoverStop(null);
  }

  /** The stop_id of the strip row an event happened inside, if any. */
  private rowStopId(e: Event): string | null {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.strip-stop-row');
    return row?.dataset.stopId ?? null;
  }

  private onPointerOver(e: Event): void {
    const stopId = this.rowStopId(e);
    if (!stopId || stopId === this.hoveredStopId) return;
    this.hoveredStopId = stopId;
    this.hooks.hoverStop(stopId);
  }

  private onPointerOut(e: Event): void {
    const stopId = this.rowStopId(e);
    if (!stopId || stopId !== this.hoveredStopId) return;
    // Moving between two children of the same row fires an out/over pair for
    // that row; only a pointer that actually left every row clears the light.
    const next = (e as PointerEvent).relatedTarget;
    if (next instanceof Element && next.closest('.strip-stop-row')) return;
    this.hoveredStopId = null;
    this.hooks.hoverStop(null);
  }

  /** The realtime read-model for the current payloads, built on demand. */
  get rtIndex(): RtIndex {
    return (this.index ??= new LiveRtIndex(this.session));
  }

  private renderPage(state: PageState): string {
    const ctx: RenderContext = { session: this.session, href: this.hooks.href };
    const index = this.rtIndex;
    switch (state.type) {
      case 'home':
        return renderFeedPage(ctx);
      case 'route':
        return renderRoutePage(ctx, index, state);
      case 'stop':
        return renderStopPage(ctx, index, state);
      case 'trip':
        return renderTripPage(ctx, index, state);
      case 'alert':
        return renderAlertPage(ctx, state);
      case 'tracker':
        return renderTrackerPage(ctx, state);
      case 'vehicle':
        return renderVehiclePage(ctx, state);
    }
  }
}
